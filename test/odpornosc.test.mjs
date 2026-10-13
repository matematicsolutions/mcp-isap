// Ciche awarie Sejm ELI w mcp-isap - E2E przez protokol MCP na lokalnej atrapie (2026-10-13).
//
// Zmierzone na zywo przy sejm-eli-mcp: zapora F5 przed api.sejm.gov.pl oddaje HTTP 200 + HTML
// "Request Rejected". Tu: `apiGet` robil `res.json()` bez sprawdzenia typu (blad parsera jako
// "sprobuj ponownie"), `apiGetText` przyjmowal strone zapory JAKO TEKST AKTU, `items ?? []`
// zamienial nieznany ksztalt w "Brak wynikow", a kod bledu ustalal regex /404|not found/
// po tresci komunikatu. Wzorce: leniwyposel/sejm-mcp #2, soba-labs/krs-mcp #4, kanon MCP 6c.
// Run: npm run test:e2e (wymaga npm run build)

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ZAPORA =
  "<html><head><title>Request Rejected</title></head><body>The requested URL was rejected. " +
  "Please consult with your administrator.<br><br>Your support ID is: 1234567890</body></html>";
const AKT = {
  address: "WDU20240000300", ELI: "DU/2024/300", publisher: "DU", year: 2024, pos: 300,
  displayAddress: "Dz.U. 2024 poz. 300", title: "Akt testowy", textHTML: true, textPDF: true,
};

async function wywolaj(odpowiedz, name, args) {
  const s = http.createServer((req, res) => {
    const [status, ct, body] = odpowiedz(req);
    res.writeHead(status, { "content-type": ct });
    res.end(body);
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const t = new StdioClientTransport({
    command: process.execPath,
    args: [join(ROOT, "dist", "index.js")],
    env: { ...process.env, SEJM_ELI_BASE_URL: `http://127.0.0.1:${s.address().port}/eli` },
    stderr: "ignore",
  });
  const c = new Client({ name: "odpornosc", version: "1" });
  await c.connect(t);
  try {
    return await c.callTool({ name, arguments: args });
  } finally {
    await c.close();
    s.close();
  }
}

const kod = (r) => r.structuredContent?.error_code;

test("zapora HTML/200 na endpoincie JSON -> upstream_blocked, nie blad parsera", async () => {
  const r = await wywolaj(() => [200, "text/html", ZAPORA], "search_acts", { title: "ustawa" });
  assert.equal(r.isError, true);
  assert.equal(kod(r), "upstream_blocked");
  assert.match(r.content[0].text, /1234567890/);
  assert.doesNotMatch(r.content[0].text, /Unexpected token|JSON/);
});

test("zapora na text.html NIE jest trescia aktu", async () => {
  const r = await wywolaj(
    (req) => req.url.endsWith("text.html")
      ? [200, "text/html;charset=utf-8", ZAPORA]
      : [200, "application/json", JSON.stringify(AKT)],
    "get_act_text", { eli: "DU/2024/300" },
  );
  assert.equal(r.isError, true);
  assert.equal(kod(r), "upstream_blocked");
  assert.doesNotMatch(r.content[0].text, /The requested URL was rejected.*Art/s);
});

test("search bez listy items -> upstream_shape, nie 'Brak wynikow'", async () => {
  const r = await wywolaj(
    () => [200, "application/json", JSON.stringify({ count: 3, wyniki: [] })],
    "search_acts", { title: "ustawa" },
  );
  assert.equal(r.isError, true);
  assert.equal(kod(r), "upstream_shape");
});

test("403 -> forbidden (przeglad czlowieka), nie 'sprobuj ponownie'", async () => {
  const r = await wywolaj(() => [403, "text/plain", "Forbidden"], "get_act", { eli: "DU/2024/300" });
  assert.equal(kod(r), "forbidden");
  assert.doesNotMatch(r.content[0].text, /Sprobuj ponownie/);
});

test("404 -> not_found po STATUSIE, 503 -> upstream_unavailable", async () => {
  const r404 = await wywolaj(() => [404, "text/plain;charset=UTF-8", "Act not found"], "get_act", { eli: "DU/2024/300" });
  assert.equal(kod(r404), "not_found");
  const r503 = await wywolaj(() => [503, "text/html", "<html>busy</html>"], "get_act", { eli: "DU/2024/300" });
  assert.equal(kod(r503), "upstream_unavailable");
});

// Wygasly tekst jednolity: nastepce szukamy przez akt bazowy. Do 2026-10-13 `catch { supersededBy = [] }`
// - nieudane sprawdzenie wygladalo jak "brak nastepcy" (anty-wzorzec PawelHaracz #4).
const TJ_WYGASLY = {
  ...AKT, ELI: "DU/2020/100", address: "WDU20200000100", year: 2020, pos: 100,
  inForce: "NOT_IN_FORCE", status: "akt jednorazowy",
  references: { "Tekst jednolity dla aktu": [{ id: "DU/1990/50" }] },
};
const tjOdpowiedz = (bazowy) => (req) => {
  if (req.url.endsWith("/acts/DU/2020/100/text.html")) return [200, "text/html", "<html><body><p>Art. 1. Tresc.</p></body></html>"];
  if (req.url.endsWith("/acts/DU/2020/100")) return [200, "application/json", JSON.stringify(TJ_WYGASLY)];
  if (req.url.endsWith("/acts/DU/1990/50")) return bazowy;
  return [404, "text/plain", "Act not found"];
};

test("nieudane sprawdzenie nastepcy to 'unavailable', nie 'brak nastepcy'", async () => {
  const r = await wywolaj(tjOdpowiedz([503, "text/html", "<html>busy</html>"]), "get_act_text", { eli: "DU/2020/100" });
  assert.notEqual(r.isError, true, r.content?.[0]?.text);
  assert.equal(r.structuredContent.superseded_by_status, "unavailable");
  assert.match(r.content[0].text, /nie udalo sie sprawdzic/i);
});

test("kontrola pozytywna: sprawdzony nastepca -> ok i lista", async () => {
  const bazowy = { ...AKT, ELI: "DU/1990/50", references: { "Inf. o tekscie jednolitym": [{ id: "DU/2020/100" }, { id: "DU/2024/7" }] } };
  const r = await wywolaj(tjOdpowiedz([200, "application/json", JSON.stringify(bazowy)]), "get_act_text", { eli: "DU/2020/100" });
  assert.equal(r.structuredContent.superseded_by_status, "ok");
  assert.deepEqual(r.structuredContent.superseded_by_eli, ["DU/2024/7"]);
});

test("kontrola pozytywna: prawdziwy JSON z charset przechodzi", async () => {
  const r = await wywolaj(
    () => [200, "application/json;charset=UTF-8", JSON.stringify({ count: 1, totalCount: 1, items: [AKT] })],
    "search_acts", { title: "ustawa" },
  );
  assert.notEqual(r.isError, true, r.content?.[0]?.text);
  assert.match(r.content[0].text, /2024/);
});
