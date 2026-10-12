/**
 * Fake Stripe.js of the end-to-end suite (VTC-048, docs/process/e2e.md). TEST ONLY: served by
 * Playwright in place of https://js.stripe.com/* (route interception, `e2e/base.ts`), never
 * shipped with the application. The serving fixture prepends the base URL of the local fake
 * Stripe API (`window.__AVELYS_FAKE_STRIPE_API__`).
 *
 * It implements the Stripe.js surface the application uses (`@stripe/react-stripe-js` Elements
 * and Payment Element, `confirmSetup`, `retrieveSetupIntent`, `confirmPayment`,
 * `handleNextAction`, `retrievePaymentIntent`) with Stripe's result shapes. The Payment Element
 * is a plain card number field; strong customer authentication opens a simulated 3-D Secure
 * dialog with the same « Complete » / « Fail » choices as Stripe's test authentication page.
 */
(function installFakeStripe() {
  const api = window.__AVELYS_FAKE_STRIPE_API__;

  async function call(method, path, body) {
    const response = await fetch(`${api}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json();
    return response.ok ? { ok: true, json } : { ok: false, error: json.error };
  }

  /** Simulated 3-D Secure window: resolves "complete" or "fail" on the visitor's choice. */
  function challenge() {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.setAttribute("data-fake-stripe", "challenge");
      overlay.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;" +
        "justify-content:center;background:rgba(0,0,0,.45)";
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-label", "3D Secure authentication (simulated)");
      dialog.style.cssText =
        "background:#fff;color:#111;padding:24px;max-width:24rem;font:16px sans-serif";
      const title = document.createElement("p");
      title.textContent = "3D Secure 2 Test Page (fake Stripe, E2E)";
      dialog.append(title);
      for (const [label, outcome] of [
        ["Complete", "complete"],
        ["Fail", "fail"],
      ]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.style.cssText = "margin:12px 12px 0 0;padding:8px 16px";
        button.addEventListener("click", () => {
          overlay.remove();
          resolve(outcome);
        });
        dialog.append(button);
      }
      overlay.append(dialog);
      document.body.append(overlay);
    });
  }

  function createElement(type) {
    const listeners = new Map();
    let input = null;
    let readyFired = false;
    const emit = (event, payload) => {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    };
    const element = {
      __type: type,
      mount(target) {
        const node = typeof target === "string" ? document.querySelector(target) : target;
        const wrapper = document.createElement("div");
        wrapper.setAttribute("data-fake-stripe", "payment-element");
        wrapper.style.cssText = "border:1px dashed #8c877e;padding:12px";
        const label = document.createElement("label");
        label.textContent = "Card number (fake Stripe, E2E)";
        label.style.cssText = "display:flex;flex-direction:column;gap:4px";
        input = document.createElement("input");
        input.name = "cardnumber";
        input.autocomplete = "off";
        input.inputMode = "numeric";
        input.addEventListener("input", () =>
          emit("change", { elementType: type, empty: input.value === "", complete: false }),
        );
        label.append(input);
        wrapper.append(label);
        node.append(wrapper);
        setTimeout(() => {
          readyFired = true;
          emit("ready", { elementType: type });
        }, 50);
      },
      on(event, listener) {
        const set = listeners.get(event) ?? new Set();
        set.add(listener);
        listeners.set(event, set);
        if (event === "ready" && readyFired) setTimeout(() => listener({ elementType: type }), 0);
        return element;
      },
      off(event, listener) {
        listeners.get(event)?.delete(listener);
        return element;
      },
      update() {},
      focus() {
        input?.focus();
      },
      blur() {},
      clear() {
        if (input) input.value = "";
      },
      unmount() {},
      destroy() {},
      cardNumber() {
        return input ? input.value : "";
      },
    };
    return element;
  }

  function createElements(options) {
    const created = [];
    return {
      __clientSecret: options?.clientSecret,
      create(type) {
        const element = createElement(type);
        created.push(element);
        return element;
      },
      getElement(type) {
        return created.find((element) => element.__type === type) ?? null;
      },
      update() {},
      fetchUpdates: async () => ({}),
      submit: async () => ({}),
      __cardNumber() {
        return created.find((element) => element.__type === "payment")?.cardNumber() ?? "";
      },
    };
  }

  async function confirmSetup({ elements }) {
    const clientSecret = elements.__clientSecret;
    const confirmed = await call("POST", "/e2e/v1/setup_intents/confirm", {
      clientSecret,
      cardNumber: elements.__cardNumber(),
    });
    if (!confirmed.ok) return { error: confirmed.error };
    if (!confirmed.json.challenge) return { setupIntent: confirmed.json.setupIntent };
    const outcome = await challenge();
    const authenticated = await call("POST", "/e2e/v1/setup_intents/authenticate", {
      clientSecret,
      outcome,
    });
    return authenticated.ok
      ? { setupIntent: authenticated.json.setupIntent }
      : { error: authenticated.error };
  }

  async function authenticatePaymentIntent(clientSecret) {
    const outcome = await challenge();
    const authenticated = await call("POST", "/e2e/v1/payment_intents/authenticate", {
      clientSecret,
      outcome,
    });
    return authenticated.ok
      ? { paymentIntent: authenticated.json.paymentIntent }
      : { error: authenticated.error };
  }

  async function confirmPayment({ clientSecret, confirmParams }) {
    const confirmed = await call("POST", "/e2e/v1/payment_intents/confirm", {
      clientSecret,
      paymentMethod: confirmParams?.payment_method ?? null,
    });
    if (!confirmed.ok) return { error: confirmed.error };
    if (!confirmed.json.challenge) return { paymentIntent: confirmed.json.paymentIntent };
    return authenticatePaymentIntent(clientSecret);
  }

  async function handleNextAction({ clientSecret }) {
    return authenticatePaymentIntent(clientSecret);
  }

  async function retrieveSetupIntent(clientSecret) {
    const read = await call(
      "GET",
      `/e2e/v1/setup_intents?client_secret=${encodeURIComponent(clientSecret)}`,
    );
    return read.ok ? { setupIntent: read.json.setupIntent } : { error: read.error };
  }

  async function retrievePaymentIntent(clientSecret) {
    const read = await call(
      "GET",
      `/e2e/v1/payment_intents?client_secret=${encodeURIComponent(clientSecret)}`,
    );
    return read.ok ? { paymentIntent: read.json.paymentIntent } : { error: read.error };
  }

  const unsupported = () => Promise.reject(new Error("Not implemented by the fake Stripe.js"));

  function Stripe(publishableKey) {
    if (!/^pk_test_/.test(publishableKey)) throw new Error("fake Stripe.js: test keys only");
    return {
      elements: createElements,
      confirmSetup,
      retrieveSetupIntent,
      confirmPayment,
      handleNextAction,
      retrievePaymentIntent,
      createToken: unsupported,
      createPaymentMethod: unsupported,
      confirmCardPayment: unsupported,
      _registerWrapper() {},
      registerAppInfo() {},
    };
  }
  // The release train @stripe/stripe-js expects (no version warning in the console).
  Stripe.version = "dahlia";
  window.Stripe = Stripe;
})();
