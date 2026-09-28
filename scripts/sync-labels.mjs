#!/usr/bin/env node
// Creates or updates the labels in .github/labels.json. Idempotent (gh label create --force).
// Labels not in the file are left untouched.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const labels = JSON.parse(readFileSync(new URL("../.github/labels.json", import.meta.url), "utf8"));

for (const { name, color, description } of labels) {
  execFileSync(
    "gh",
    ["label", "create", name, "--color", color, "--description", description, "--force"],
    {
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
}
console.log(`Synced ${labels.length} labels.`);
