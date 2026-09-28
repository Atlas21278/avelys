#!/usr/bin/env node
// Imports docs/backlog (epics + tickets) into GitHub Issues.
// Dry run by default; pass --apply to create issues. Idempotent: an issue whose title starts
// with the same ID ("VTC-002 — …") is never created twice.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const apply = process.argv.includes("--apply");
const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const STATUS_LABELS = {
  BACKLOG: "status:backlog",
  NEEDS_DECISION: "status:needs-decision",
  READY: "status:ready",
  IN_PROGRESS: "status:in-progress",
  PR_OPEN: "status:pr-open",
  REVIEW: "status:review",
  BLOCKED: "status:blocked",
  READY_TO_MERGE: "status:ready-to-merge",
  DONE: "status:done",
};

function gh(args) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

function field(markdown, name) {
  const match = markdown.match(new RegExp(`^- \\*\\*${name}\\*\\* : (.+)$`, "m"));
  return match?.[1]?.trim() ?? "";
}

function parseEpics() {
  const rows = read("docs/backlog/epics.md")
    .split("\n")
    .filter((line) => /^\|\s*EPIC-\d{2}\s*\|/.test(line));
  return rows.map((line) => {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    const [id, title, goal, dependsOn, decisions, order] = cells;
    return {
      id,
      title: `${id} — ${title}`,
      labels: ["type:epic", `epic:${id.slice(5)}`, "status:backlog"],
      body: [
        `**Objectif** : ${goal}`,
        `**Dépend de** : ${dependsOn}`,
        `**Décisions liées** : ${decisions}`,
        `**Ordre de construction (§46)** : ${order}`,
        "",
        "Source : `docs/backlog/epics.md`",
      ].join("\n"),
      done: false,
    };
  });
}

function parseTickets() {
  const dir = new URL("docs/backlog/tickets/", root);
  return readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => {
      const markdown = readFileSync(new URL(file, dir), "utf8");
      const heading = markdown.match(/^# (.+)$/m)?.[1];
      if (!heading) throw new Error(`No title in ${file}`);
      const id = heading.split(" ")[0];
      const statusWord = field(markdown, "Statut").split(/[\s(—]/)[0];
      const risk = field(markdown, "Risque").split(/\s/)[0].toLowerCase();
      const epic = field(markdown, "Epic").replace("EPIC-", "");
      const human = /\*\*oui\*\*/.test(field(markdown, "Validation humaine"));
      const labels = [
        id.startsWith("INFRA-") ? "type:infra" : "type:feature",
        `epic:${epic}`,
        `risk:${risk}`,
        STATUS_LABELS[statusWord] ?? "status:backlog",
      ];
      if (human) labels.push("human-approval");
      return {
        id,
        epic: `EPIC-${epic}`,
        title: heading,
        labels,
        body: `${markdown.replace(/^# .+\n+/, "")}\n---\nSource : \`docs/backlog/tickets/${file}\``,
        done: statusWord === "DONE",
      };
    });
}

function existingIssues() {
  const list = JSON.parse(
    gh(["issue", "list", "--state", "all", "--limit", "1000", "--json", "number,title"]),
  );
  const byId = new Map();
  for (const { number, title } of list) byId.set(title.split(" ")[0], number);
  return byId;
}

const tmp = mkdtempSync(join(tmpdir(), "avelys-backlog-"));

function createIssue(item) {
  const bodyFile = join(tmp, `${item.id}.md`);
  writeFileSync(bodyFile, item.body);
  const args = ["issue", "create", "--title", item.title, "--body-file", bodyFile];
  for (const label of item.labels) args.push("--label", label);
  const url = gh(args);
  const number = Number(url.split("/").pop());
  if (item.done) gh(["issue", "close", String(number), "--reason", "completed"]);
  return number;
}

try {
  const epics = parseEpics();
  const tickets = parseTickets();
  const known = existingIssues();
  const mapping = new Map(known);

  for (const item of [...epics, ...tickets]) {
    if (known.has(item.id)) {
      console.log(`skip    ${item.id} (#${known.get(item.id)} exists)`);
      continue;
    }
    if (!apply) {
      console.log(
        `create  ${item.title}  [${item.labels.join(", ")}]${item.done ? " → closed" : ""}`,
      );
      continue;
    }
    const number = createIssue(item);
    mapping.set(item.id, number);
    console.log(`created ${item.id} → #${number}`);
  }

  // Epic bodies list their tickets as a task list (sub-issue links need extra API scopes).
  if (apply) {
    for (const epic of epics) {
      const children = tickets.filter((ticket) => ticket.epic === epic.id);
      if (children.length === 0) continue;
      const lines = children.map(
        (ticket) => `- [${ticket.done ? "x" : " "}] #${mapping.get(ticket.id)} ${ticket.id}`,
      );
      const bodyFile = join(tmp, `${epic.id}-body.md`);
      writeFileSync(bodyFile, `${epic.body}\n\n## Tickets\n\n${lines.join("\n")}\n`);
      gh(["issue", "edit", String(mapping.get(epic.id)), "--body-file", bodyFile]);
    }
  }

  console.log("\nID → issue");
  for (const item of [...epics, ...tickets]) {
    console.log(`${item.id}\t${mapping.has(item.id) ? `#${mapping.get(item.id)}` : "(dry run)"}`);
  }
  if (!apply) console.log("\nDry run only. Re-run with --apply to create the issues.");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
