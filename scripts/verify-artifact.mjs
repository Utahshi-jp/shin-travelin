#!/usr/bin/env node
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

const REQUIRED = [
  { path: "docs/requirements.md", kind: "file", reason: "FR/AR source of truth" },
  { path: "docs/basic-design.md", kind: "file", reason: "Basic design reference" },
  { path: "docs/detail-design.md", kind: "file", reason: "Implementation contract" },
  { path: "docs/db-structure.md", kind: "file", reason: "Database schema spec" },
  { path: "docs/legacy-extract-and-mapping.md", kind: "file", reason: "Legacy mapping reference" },
  { path: "src", kind: "dir", reason: "Next.js frontend" },
  { path: "backend/src", kind: "dir", reason: "NestJS services" },
  { path: "backend/prisma/schema.prisma", kind: "file", reason: "Prisma schema" },
];

const cwd = resolve(process.cwd());
const failures = [];

async function ensure(entry) {
  const target = resolve(cwd, entry.path);
  try {
    await access(target, constants.R_OK);
    const stats = await stat(target);
    if (entry.kind === "dir" && !stats.isDirectory()) {
      throw new Error("not a directory");
    }
    if (entry.kind === "file" && !stats.isFile()) {
      throw new Error("not a file");
    }
    console.log(`✔ ${entry.path}`);
  } catch (error) {
    failures.push({ entry, error: error instanceof Error ? error.message : String(error) });
    console.error(`✖ ${entry.path} (${entry.reason}) - ${failures.at(-1).error}`);
  }
}

(async () => {
  await Promise.all(REQUIRED.map(ensure));
  if (failures.length) {
    console.error(`\nArtifact check failed for ${failures.length} item(s). Ensure the files above are present before packaging.`);
    process.exitCode = 1;
  } else {
    console.log("\nAll required artifacts are present.");
  }
})();
