// E2E przez protokol MCP: zbudowany serwer (dist/) + lokalna atrapa Sejm ELI (SEJM_ELI_BASE_URL).
//
// W odroznieniu od test/get-act-text.mjs (podmieniony globalny fetch w procesie serwera) tu
// serwer chodzi po PRAWDZIWYM HTTP do `http.createServer`, wiec sprawdzamy to, co agent dostaje
// przez protokol razem z warstwa sieciowa. Odpowiedzi aktow: zamrozone w test/fixtures.mjs
// (zdjete z api.sejm.gov.pl 2026-07-31); ksztalt /acts/search zmierzony na zywo 2026-10-13
// (`count, items, offset, totalCount, searchQuery`), brak aktu: 404 text/plain "Act not found".
//
// Run: npm run test:e2e (wymaga npm run build)

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Import podmienia globalny fetch TEGO procesu (efekt uboczny fixtures.mjs) - test go nie uzywa.
import { FIXTURES } from "./fixtures.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PREFIX = "/eli";

const WYSZUKANIE = {
  count: 1,
  items: [FIXTURES["/acts/DU/2024/1061"].json],
  offset: 0,
  totalCount: 1,
  searchQuery: { title: "Kodeks cywilny", limit: 10 },
};

async function atrapa(obsluga) {
  const s = http.createServer((req, res) => {
    const [status, ct, body] = obsluga(req.url.startsWith(PREFIX) ? req.url.slice(PREFIX.length) : req.url);
    res.writeHead(status, { "content-type": ct });
    res.end(body);
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${s.address().port}${PREFIX}`, zamknij: () => s.close() };
}

const eli = (sciezka) => {
  if (sciezka.startsWith("/acts/search")) return [200, "application/json", JSON.stringify(WYSZUKANIE)];
  const hit = FIXTURES[sciezka];
  if (!hit) return [404, "text/plain;charset=UTF-8", "Act not found"];
  if (hit.json !== undefined) return [200, "application/json", JSON.stringify(hit.json)];
  return [200, "text/html", hit.text];
};

async function klient(base) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(ROOT, "dist", "index.js")],
    env: { ...process.env, SEJM_ELI_BASE_URL: base },
    stderr: "ignore",
  });
  const c = new Client({ name: "e2e-atrapa", version: "1.0" });
  await c.connect(transport);
  return c;
}

// Wzorzec soba-labs/krs-mcp #1 (`src/tools/common.ts:38-51`): blok provenance w KAZDYM udanym
// wyniku - zrodlo, czas pobrania, czas wytworzenia (jawne null zamiast zgadywania) i co zrobil
// konektor. Pod warunki ponownego wykorzystania informacji sektora publicznego.
const WYWOLANIA = {
  search_acts: { title: "Kodeks cywilny" },
  get_act: { eli: "DU/2024/1061" },
  get_act_text: { eli: "DU/2024/1061", search_text: "Art. 118." },
};

test("provenance w kazdym udanym wyniku - pelny mianownik narzedzi", async () => {
  const { base, zamknij } = await atrapa(eli);
  const c = await klient(base);
  try {
    const narzedzia = (await c.listTools()).tools.map((t) => t.name).sort();
    assert.ok(narzedzia.length > 0, "pusta lista narzedzi = BLOKADA");
    assert.deepEqual(narzedzia, Object.keys(WYWOLANIA).sort(), "kazde narzedzie musi miec wywolanie");
    for (const [name, args] of Object.entries(WYWOLANIA)) {
      const r = await c.callTool({ name, arguments: args });
      assert.notEqual(r.isError, true, `${name}: ${r.content?.[0]?.text}`);
      assert.ok(r.structuredContent?.citations?.length > 0, `${name}: brak citations - atrapa nie trafila`);
      const p = r.structuredContent?.provenance;
      assert.ok(p, `${name}: brak provenance`);
      assert.ok(p.source && String(p.source).includes(base), `${name}: source = ${p.source}`);
      assert.ok(!Number.isNaN(Date.parse(p.retrieved_at)), `${name}: retrieved_at = ${p.retrieved_at}`);
      assert.equal(p.source_produced_at, null, `${name}: source_produced_at ma byc jawnym null`);
      assert.ok(p.processing && p.processing.length > 10, `${name}: processing`);
    }
  } finally {
    await c.close();
    zamknij();
  }
});

test("kontrola pozytywna: brak aktu (404) -> not_found, bez provenance w bledzie", async () => {
  const { base, zamknij } = await atrapa(eli);
  const c = await klient(base);
  try {
    const r = await c.callTool({ name: "get_act", arguments: { eli: "DU/2018/999999" } });
    assert.equal(r.isError, true);
    assert.equal(r.structuredContent?.error_code, "not_found", r.content?.[0]?.text);
    assert.equal(r.structuredContent?.provenance, undefined);
  } finally {
    await c.close();
    zamknij();
  }
});
