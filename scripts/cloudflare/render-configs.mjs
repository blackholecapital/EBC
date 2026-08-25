#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const resources = [
  {
    env: "EBC_DASHBOARD_D1_ID",
    database: "ebc-call-center-dashboard",
    files: ["apps/dashboard/wrangler.toml"],
  },
  {
    env: "EBC_EVENTS_D1_ID",
    database: "ebc-call-center-events",
    files: [
      "apps/dashboard/wrangler.toml",
      "apps/blackhole-concierge-worker/wrangler.toml",
    ],
  },
];

function requiredId(name) {
  const value = String(process.env[name] || "").trim();
  if (!uuidPattern.test(value)) {
    throw new Error(`${name} must be a Cloudflare D1 UUID`);
  }
  return value;
}

function replaceDatabaseId(source, database, id, file) {
  const escaped = database.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(database_name\\s*=\\s*"${escaped}"\\s*\\n\\s*database_id\\s*=\\s*")[^"]+(\")`);
  if (!pattern.test(source)) {
    throw new Error(`Could not find ${database} in ${file}`);
  }
  return source.replace(pattern, `$1${id}$2`);
}

const updates = new Map();
for (const resource of resources) {
  const id = requiredId(resource.env);
  for (const relative of resource.files) {
    const absolute = path.join(repoRoot, relative);
    const current = updates.has(absolute) ? updates.get(absolute) : await readFile(absolute, "utf8");
    updates.set(absolute, replaceDatabaseId(current, resource.database, id, relative));
  }
}

for (const [file, contents] of updates) {
  await writeFile(file, contents);
  console.log(`Configured ${path.relative(repoRoot, file)}`);
}
