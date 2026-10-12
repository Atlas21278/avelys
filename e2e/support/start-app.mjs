/**
 * Starts the production build of the application for the end-to-end suite (VTC-048), the way
 * the Docker image runs it (`output: "standalone"`, ADR-0013): `node .next/standalone/server.js`
 * with the static assets next to it. Requires `pnpm build` first. The environment comes from
 * Playwright's `webServer.env` (e2e/support/env.ts).
 *
 * Windows only: the standalone output keeps pnpm's links to package folders as file symlinks,
 * which Node cannot follow there (EPERM). They are replaced by directory junctions pointing at
 * the same targets, which needs no privilege. Linux (CI, Docker) runs the output unchanged.
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  readdirSync,
  readlinkSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const standalone = join(root, ".next", "standalone");

if (!existsSync(join(standalone, "server.js"))) {
  console.error("E2E: no production build found. Run `pnpm build` first (docs/process/e2e.md).");
  process.exit(1);
}

/** Replaces every directory symlink under `dir` by a junction to the same target. */
function linksToJunctions(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const target = resolve(dirname(path), readlinkSync(path));
      let isDirectory = false;
      try {
        isDirectory = statSync(target).isDirectory();
      } catch {
        continue;
      }
      if (isDirectory && !lstatSync(path).isDirectory()) {
        unlinkSync(path);
        symlinkSync(target, path, "junction");
      }
    } else if (entry.isDirectory()) {
      linksToJunctions(path);
    }
  }
}

if (process.platform === "win32") linksToJunctions(join(standalone, "node_modules"));

// The standalone output does not include the static assets nor `public/` (Next.js docs).
cpSync(join(root, ".next", "static"), join(standalone, ".next", "static"), { recursive: true });
if (existsSync(join(root, "public"))) {
  cpSync(join(root, "public"), join(standalone, "public"), { recursive: true });
}

await import(pathToFileURL(join(standalone, "server.js")).href);
