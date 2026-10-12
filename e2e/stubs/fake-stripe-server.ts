/**
 * Local fake of the Stripe API for the end-to-end suite (VTC-048, docs/process/e2e.md).
 * TEST ONLY: never deployed, never imported by the application. Started by Playwright
 * (`playwright.config.ts`, `webServer`) on a loopback port; the application reaches it only
 * through `E2E_STRIPE_API_URL`, which the environment schema refuses outside APP_ENV local/ci.
 *
 * It implements the subset of the Stripe API the application uses, with Stripe's object shapes:
 *
 * - server side (stripe-node, form-encoded): Customers, SetupIntents (create, retrieve with
 *   `expand[]=customer`), PaymentIntents (off-session create and confirm, list by Customer,
 *   retrieve, cancel), with idempotency keys replayed like Stripe;
 * - browser side (`e2e/stubs/fake-stripe.js`, JSON + CORS under `/e2e/`): confirmation of the
 *   SetupIntent with a test card number, the on-session confirmation of the regularisation page,
 *   and the result of the simulated 3-D Secure window;
 * - webhooks: `payment_intent.*` events signed like Stripe (`Stripe-Signature`, HMAC-SHA256 of
 *   `{t}.{payload}`) with a fixed test signing secret, posted to the application and retried.
 *
 * The behaviour of each card follows Stripe's documented test cards (`e2e/stubs/cards.ts`).
 * State is in memory and lost on restart. Logs carry ids and statuses only.
 */
import { createHmac, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { testCardByNumber, type TestCard } from "./cards";

const port = Number(process.env.FAKE_STRIPE_PORT ?? 12111);
const webhookUrl = process.env.FAKE_STRIPE_WEBHOOK_URL;
const webhookSecret = process.env.FAKE_STRIPE_WEBHOOK_SECRET;
if (!webhookUrl || !webhookSecret) {
  console.error("fake-stripe: FAKE_STRIPE_WEBHOOK_URL and FAKE_STRIPE_WEBHOOK_SECRET are required");
  process.exit(1);
}

type Json = Record<string, unknown>;

type Customer = { id: string; object: "customer"; email: string | null; metadata: Json };

type SetupIntent = {
  id: string;
  object: "setup_intent";
  client_secret: string;
  customer: string | null;
  status: string;
  usage: string;
  payment_method: string | null;
  payment_method_types: string[];
  metadata: Json;
  livemode: false;
  created: number;
  last_setup_error: Json | null;
};

type PaymentIntent = {
  id: string;
  object: "payment_intent";
  client_secret: string;
  amount: number;
  currency: string;
  customer: string | null;
  payment_method: string | null;
  payment_method_types: string[];
  status: string;
  capture_method: string;
  metadata: Json;
  livemode: false;
  created: number;
  last_payment_error: Json | null;
};

const customers = new Map<string, Customer>();
const setupIntents = new Map<string, SetupIntent>();
const paymentIntents = new Map<string, PaymentIntent>();
/** Payment method id → test card it was created from. */
const paymentMethods = new Map<string, TestCard>();
/** SetupIntent id → card waiting for the 3-D Secure outcome. */
const pendingSetupCards = new Map<string, TestCard>();
/** `METHOD path|Idempotency-Key` → first response, replayed like Stripe. */
const idempotent = new Map<string, { status: number; body: Json }>();

const ALPHANUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function randomId(prefix: string, length = 24): string {
  const bytes = randomBytes(length);
  let id = "";
  for (const byte of bytes) id += ALPHANUMERIC[byte % ALPHANUMERIC.length];
  return `${prefix}_${id}`;
}
const now = () => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------------------------

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Json,
  ) {
    super(`HTTP ${status}`);
  }
}

function stripeError(status: number, error: Json): HttpError {
  return new HttpError(status, { error });
}

const notFound = (what: string, id: string) =>
  stripeError(404, {
    type: "invalid_request_error",
    code: "resource_missing",
    message: `No such ${what}: '${id}'`,
    param: "id",
  });

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function send(response: ServerResponse, status: number, body: Json, cors = false): void {
  response.writeHead(status, {
    "content-type": "application/json",
    "request-id": randomId("req", 14),
    ...(cors ? corsHeaders : {}),
  });
  response.end(JSON.stringify(body));
}

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

/** Form fields of a stripe-node request (`a[b]`, `a[0]` keys kept flat). */
type Form = URLSearchParams;

function metadataOf(form: Form): Json {
  const metadata: Json = {};
  for (const [key, value] of form) {
    const match = /^metadata\[(.+)\]$/.exec(key);
    if (match?.[1]) metadata[match[1]] = value;
  }
  return metadata;
}

function listOf(form: Form, name: string): string[] {
  return [...form]
    .filter(([key]) => key === `${name}[]` || new RegExp(`^${name}\\[\\d+\\]$`).test(key))
    .map(([, value]) => value);
}

function required(form: Form, name: string): string {
  const value = form.get(name);
  if (!value) {
    throw stripeError(400, {
      type: "invalid_request_error",
      code: "parameter_missing",
      param: name,
      message: `Missing required param: ${name}.`,
    });
  }
  return value;
}

// ---------------------------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------------------------

function signature(payload: string, timestamp: number): string {
  const digest = createHmac("sha256", webhookSecret as string)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

/** Posts a signed event like Stripe, asynchronously, retrying a refused delivery. */
function emit(type: string, object: Json): void {
  const event = {
    id: randomId("evt"),
    object: "event",
    api_version: "2026-08-26.dahlia",
    created: now(),
    data: { object: structuredClone(object) },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
  };
  const payload = JSON.stringify(event);
  void (async () => {
    // Stripe delivers after the API answer: a short delay keeps that order.
    await new Promise((resolve) => setTimeout(resolve, 150));
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        const response = await fetch(webhookUrl as string, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "stripe-signature": signature(payload, now()),
          },
          body: payload,
        });
        console.log(`fake-stripe: ${type} ${event.id} -> ${response.status} (attempt ${attempt})`);
        if (response.ok) return;
      } catch {
        console.log(`fake-stripe: ${type} ${event.id} -> unreachable (attempt ${attempt})`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  })();
}

function emitOutcome(intent: PaymentIntent): void {
  if (intent.status === "succeeded") emit("payment_intent.succeeded", intent);
  else if (intent.status === "requires_action") emit("payment_intent.requires_action", intent);
  else if (intent.status === "requires_payment_method") {
    emit("payment_intent.payment_failed", intent);
  } else if (intent.status === "canceled") emit("payment_intent.canceled", intent);
}

// ---------------------------------------------------------------------------------------------
// Server API (stripe-node)
// ---------------------------------------------------------------------------------------------

function customerOf(id: string | null): Customer | null {
  return id ? (customers.get(id) ?? null) : null;
}

function createCustomer(form: Form): Customer {
  const customer: Customer = {
    id: randomId("cus", 14),
    object: "customer",
    email: form.get("email"),
    metadata: metadataOf(form),
  };
  customers.set(customer.id, customer);
  return customer;
}

function createSetupIntent(form: Form): SetupIntent {
  const id = randomId("seti");
  const customer = form.get("customer");
  if (customer && !customers.has(customer)) throw notFound("customer", customer);
  const intent: SetupIntent = {
    id,
    object: "setup_intent",
    client_secret: `${id}_secret_${randomId("x").slice(2)}`,
    customer,
    status: "requires_payment_method",
    usage: form.get("usage") ?? "off_session",
    payment_method: null,
    payment_method_types: listOf(form, "payment_method_types"),
    metadata: metadataOf(form),
    livemode: false,
    created: now(),
    last_setup_error: null,
  };
  setupIntents.set(id, intent);
  return intent;
}

function retrieveSetupIntent(id: string, query: URLSearchParams): Json {
  const intent = setupIntents.get(id);
  if (!intent) throw notFound("setupintent", id);
  if (listOf(query, "expand").includes("customer")) {
    return { ...intent, customer: customerOf(intent.customer) ?? intent.customer };
  }
  return intent;
}

function authenticationRequiredError(intent: PaymentIntent): Json {
  return {
    type: "card_error",
    code: "authentication_required",
    decline_code: "authentication_required",
    message:
      "Your card was declined. This transaction requires authentication. (fake Stripe, E2E test)",
    payment_intent: intent,
    payment_method: { id: intent.payment_method, object: "payment_method" },
  };
}

function createPaymentIntent(form: Form): PaymentIntent {
  const id = randomId("pi");
  const customer = form.get("customer");
  if (customer && !customers.has(customer)) throw notFound("customer", customer);
  const paymentMethod = form.get("payment_method");
  const intent: PaymentIntent = {
    id,
    object: "payment_intent",
    client_secret: `${id}_secret_${randomId("x").slice(2)}`,
    amount: Number(required(form, "amount")),
    currency: required(form, "currency").toLowerCase(),
    customer,
    payment_method: paymentMethod,
    payment_method_types: listOf(form, "payment_method_types"),
    status: "requires_payment_method",
    capture_method: form.get("capture_method") ?? "automatic",
    metadata: metadataOf(form),
    livemode: false,
    created: now(),
    last_payment_error: null,
  };
  paymentIntents.set(id, intent);

  if (form.get("confirm") !== "true") return intent;
  const card = paymentMethod ? paymentMethods.get(paymentMethod) : undefined;
  if (!card) {
    throw stripeError(400, {
      type: "invalid_request_error",
      code: "resource_missing",
      param: "payment_method",
      message: "No such PaymentMethod.",
    });
  }
  const offSession = form.get("off_session") === "true";
  if (offSession && card.offSessionAuthenticationRequired) {
    intent.status = "requires_payment_method";
    intent.last_payment_error = {
      type: "card_error",
      code: "authentication_required",
      decline_code: "authentication_required",
      message: "This transaction requires authentication.",
    };
    emitOutcome(intent);
    throw stripeError(402, authenticationRequiredError(intent));
  }
  intent.status = "succeeded";
  emitOutcome(intent);
  return intent;
}

function retrievePaymentIntent(id: string): PaymentIntent {
  const intent = paymentIntents.get(id);
  if (!intent) throw notFound("payment_intent", id);
  return intent;
}

function listPaymentIntents(query: URLSearchParams): Json {
  const customer = query.get("customer");
  const limit = Number(query.get("limit") ?? 10);
  const all = [...paymentIntents.values()]
    .filter((intent) => !customer || intent.customer === customer)
    .sort((a, b) => b.created - a.created);
  return {
    object: "list",
    url: "/v1/payment_intents",
    has_more: all.length > limit,
    data: all.slice(0, limit),
  };
}

function cancelPaymentIntent(id: string): PaymentIntent {
  const intent = retrievePaymentIntent(id);
  if (["succeeded", "canceled", "processing"].includes(intent.status)) {
    throw stripeError(400, {
      type: "invalid_request_error",
      code: "payment_intent_unexpected_state",
      message: `This PaymentIntent's status is ${intent.status}.`,
      payment_intent: intent,
    });
  }
  intent.status = "canceled";
  emitOutcome(intent);
  return intent;
}

async function serverApi(
  method: string,
  path: string,
  query: URLSearchParams,
  request: IncomingMessage,
): Promise<{ status: number; body: Json }> {
  const form = new URLSearchParams(method === "POST" ? await readBody(request) : "");
  const key = request.headers["idempotency-key"];
  const replayKey = method === "POST" && typeof key === "string" ? `${path}|${key}` : null;
  const replayed = replayKey ? idempotent.get(replayKey) : undefined;
  if (replayed) return replayed;

  let result: { status: number; body: Json };
  try {
    result = { status: 200, body: route(method, path, query, form) };
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    result = { status: error.status, body: error.body };
  }
  // Stripe replays the first answer of a key, errors included (except 5xx / rate limits).
  if (replayKey) idempotent.set(replayKey, structuredClone(result));
  return result;
}

function route(method: string, path: string, query: URLSearchParams, form: Form): Json {
  const segments = path.split("/").filter(Boolean); // ["v1", resource, id?, action?]
  const [, resource, id, action] = segments;
  if (method === "POST" && resource === "customers" && !id) return createCustomer(form);
  if (resource === "setup_intents") {
    if (method === "POST" && !id) return createSetupIntent(form);
    if (method === "GET" && id && !action) return retrieveSetupIntent(id, query);
  }
  if (resource === "payment_intents") {
    if (method === "POST" && !id) return createPaymentIntent(form);
    if (method === "GET" && !id) return listPaymentIntents(query);
    if (method === "GET" && id && !action) return retrievePaymentIntent(id);
    if (method === "POST" && id && action === "cancel") return cancelPaymentIntent(id);
  }
  throw stripeError(404, {
    type: "invalid_request_error",
    message: `Unrecognized request URL (${method}: ${path}) in the fake Stripe API.`,
  });
}

// ---------------------------------------------------------------------------------------------
// Browser API (fake Stripe.js)
// ---------------------------------------------------------------------------------------------

function setupIntentByClientSecret(secret: unknown): SetupIntent {
  const intent = [...setupIntents.values()].find((item) => item.client_secret === secret);
  if (!intent) {
    throw stripeError(400, {
      type: "invalid_request_error",
      code: "resource_missing",
      message: "No such setupintent client secret.",
    });
  }
  return intent;
}

function paymentIntentByClientSecret(secret: unknown): PaymentIntent {
  const intent = [...paymentIntents.values()].find((item) => item.client_secret === secret);
  if (!intent) {
    throw stripeError(400, {
      type: "invalid_request_error",
      code: "resource_missing",
      message: "No such payment_intent client secret.",
    });
  }
  return intent;
}

function saveCard(intent: SetupIntent, card: TestCard): void {
  const paymentMethod = randomId("pm");
  paymentMethods.set(paymentMethod, card);
  intent.payment_method = paymentMethod;
  intent.status = "succeeded";
  intent.last_setup_error = null;
}

const AUTHENTICATION_FAILED = {
  type: "invalid_request_error",
  code: "payment_intent_authentication_failure",
  message:
    "Nous n'avons pas pu authentifier votre moyen de paiement. (fake Stripe, échec simulé du 3-D Secure)",
};

function browserApi(method: string, path: string, query: URLSearchParams, body: Json): Json {
  if (method === "POST" && path === "/e2e/v1/setup_intents/confirm") {
    const intent = setupIntentByClientSecret(body.clientSecret);
    if (intent.status === "succeeded") {
      throw stripeError(400, {
        type: "invalid_request_error",
        code: "setup_intent_unexpected_state",
        message: "This SetupIntent has already succeeded.",
      });
    }
    const card = testCardByNumber(String(body.cardNumber ?? ""));
    if (!card) {
      throw stripeError(402, {
        type: "card_error",
        code: "incorrect_number",
        message: "Le numéro de carte est incorrect. (fake Stripe : carte de test inconnue)",
      });
    }
    if (card.setupAuthentication) {
      intent.status = "requires_action";
      pendingSetupCards.set(intent.id, card);
      return { setupIntent: intent, challenge: true };
    }
    saveCard(intent, card);
    return { setupIntent: intent };
  }
  if (method === "POST" && path === "/e2e/v1/setup_intents/authenticate") {
    const intent = setupIntentByClientSecret(body.clientSecret);
    const card = pendingSetupCards.get(intent.id);
    pendingSetupCards.delete(intent.id);
    if (!card || intent.status !== "requires_action") {
      throw stripeError(400, { type: "invalid_request_error", message: "No pending action." });
    }
    if (body.outcome !== "complete") {
      intent.status = "requires_payment_method";
      intent.last_setup_error = AUTHENTICATION_FAILED;
      throw stripeError(402, { ...AUTHENTICATION_FAILED, setup_intent: intent });
    }
    saveCard(intent, card);
    return { setupIntent: intent };
  }
  if (method === "GET" && path === "/e2e/v1/setup_intents") {
    return { setupIntent: setupIntentByClientSecret(query.get("client_secret")) };
  }
  if (method === "POST" && path === "/e2e/v1/payment_intents/confirm") {
    const intent = paymentIntentByClientSecret(body.clientSecret);
    const paymentMethod = typeof body.paymentMethod === "string" ? body.paymentMethod : null;
    if (paymentMethod) intent.payment_method = paymentMethod;
    const card = intent.payment_method ? paymentMethods.get(intent.payment_method) : undefined;
    if (!card) {
      throw stripeError(400, { type: "invalid_request_error", message: "No payment method." });
    }
    if (intent.status === "succeeded") {
      throw stripeError(400, {
        type: "invalid_request_error",
        code: "payment_intent_unexpected_state",
        message: "This PaymentIntent has already succeeded.",
      });
    }
    if (card.onSessionAuthentication) {
      intent.status = "requires_action";
      return { paymentIntent: intent, challenge: true };
    }
    intent.status = "succeeded";
    intent.last_payment_error = null;
    emitOutcome(intent);
    return { paymentIntent: intent };
  }
  if (method === "POST" && path === "/e2e/v1/payment_intents/authenticate") {
    const intent = paymentIntentByClientSecret(body.clientSecret);
    if (intent.status !== "requires_action") {
      throw stripeError(400, { type: "invalid_request_error", message: "No pending action." });
    }
    if (body.outcome !== "complete") {
      intent.status = "requires_payment_method";
      intent.last_payment_error = { ...AUTHENTICATION_FAILED, type: "card_error" };
      emitOutcome(intent);
      throw stripeError(402, { ...AUTHENTICATION_FAILED, payment_intent: intent });
    }
    intent.status = "succeeded";
    intent.last_payment_error = null;
    emitOutcome(intent);
    return { paymentIntent: intent };
  }
  if (method === "GET" && path === "/e2e/v1/payment_intents") {
    return { paymentIntent: paymentIntentByClientSecret(query.get("client_secret")) };
  }
  throw stripeError(404, { type: "invalid_request_error", message: `No route ${path}` });
}

// ---------------------------------------------------------------------------------------------

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  const method = request.method ?? "GET";
  void (async () => {
    try {
      if (url.pathname === "/e2e/health") {
        send(response, 200, { ok: true }, true);
        return;
      }
      if (url.pathname.startsWith("/e2e/")) {
        if (method === "OPTIONS") {
          response.writeHead(204, corsHeaders);
          response.end();
          return;
        }
        const text = method === "POST" ? await readBody(request) : "";
        const body = (text ? JSON.parse(text) : {}) as Json;
        try {
          send(response, 200, browserApi(method, url.pathname, url.searchParams, body), true);
        } catch (error) {
          if (!(error instanceof HttpError)) throw error;
          send(response, error.status, error.body, true);
        }
        return;
      }
      if (url.pathname.startsWith("/v1/")) {
        const result = await serverApi(method, url.pathname, url.searchParams, request);
        console.log(`fake-stripe: ${method} ${url.pathname} -> ${result.status}`);
        send(response, result.status, result.body);
        return;
      }
      send(response, 404, { error: { type: "invalid_request_error", message: "Not found" } });
    } catch (error) {
      console.error(`fake-stripe: ${method} ${url.pathname} failed`, error);
      send(response, 500, { error: { type: "api_error", message: "fake Stripe failure" } });
    }
  })();
});

server.listen(port, "127.0.0.1", () => {
  console.log(`fake-stripe: listening on http://127.0.0.1:${port}`);
});
