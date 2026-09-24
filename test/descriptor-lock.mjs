#!/usr/bin/env node
// Descriptor lock - the tool surface a client sees must not change silently.
//
// Clients that pin tool descriptors (PATRON's MCP gateway holds a connector
// whose description or schema drifted) break when a release changes a
// descriptor nobody meant to change. This spawns the BUILT server (dist/),
// i.e. the artifact that ships, reads tools/list over stdio and compares the
// normalised descriptors with test/tools.lock.json. Digest is computed from
// canonical JSON (sorted keys), never from file bytes.
//
// Intentional change: bump the version, then
//   npm run build && node test/descriptor-lock.mjs --update

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCK = join(ROOT, "test", "tools.lock.json");

function canon(v) {
    if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
    if (v && typeof v === "object") {
        return `{${Object.keys(v)
            .sort()
            .filter((k) => v[k] !== undefined)
            .map((k) => `${JSON.stringify(k)}:${canon(v[k])}`)
            .join(",")}}`;
    }
    return JSON.stringify(v);
}
const digest = (v) => createHash("sha256").update(canon(v), "utf8").digest("hex");

async function descriptors() {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [join(ROOT, "dist", "index.js")],
        stderr: "ignore",
    });
    const client = new Client({ name: "descriptor-lock", version: "1" });
    await client.connect(transport);
    try {
        const { tools } = await client.listTools();
        const out = {};
        for (const t of [...tools].sort((a, b) => a.name.localeCompare(b.name))) {
            out[t.name] = JSON.parse(canon(t));
        }
        return out;
    } finally {
        await client.close();
    }
}

const current = await descriptors();

if (process.argv.includes("--update")) {
    const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
    const lock = {
        package_version: version,
        toolset_sha256: digest(current),
        tools: Object.fromEntries(
            Object.entries(current).map(([n, d]) => [n, { sha256: digest(d), descriptor: d }]),
        ),
    };
    writeFileSync(LOCK, JSON.stringify(lock, null, 2) + "\n", "utf8");
    console.log(`wrote ${LOCK} (${Object.keys(current).length} tools, version ${version})`);
    process.exit(0);
}

const fail = (msg) => {
    console.error(`descriptor-lock: FAIL - ${msg}`);
    process.exit(1);
};
if (!existsSync(LOCK)) fail("test/tools.lock.json is missing - an empty baseline would pass every change.");
const lock = JSON.parse(readFileSync(LOCK, "utf8"));
const locked = Object.fromEntries(Object.entries(lock.tools ?? {}).map(([n, e]) => [n, e.descriptor]));
if (Object.keys(locked).length === 0) fail("tools.lock.json lists no tools - refusing an empty baseline.");

const added = Object.keys(current).filter((n) => !(n in locked)).sort();
const removed = Object.keys(locked).filter((n) => !(n in current)).sort();
const changed = Object.keys(current)
    .filter((n) => n in locked && digest(current[n]) !== digest(locked[n]))
    .sort();
if (added.length || removed.length || changed.length) {
    fail(
        `descriptors drifted: added=${JSON.stringify(added)} removed=${JSON.stringify(removed)} ` +
            `changed=${JSON.stringify(changed)}. If intended, bump the version and run ` +
            "npm run build && node test/descriptor-lock.mjs --update",
    );
}
if (lock.toolset_sha256 !== digest(current)) fail("toolset_sha256 does not match the tools.");
console.log(`descriptor-lock: OK (${Object.keys(current).length} tools)`);
