// Bramka typow argumentow (fix dla mcp-conformance: tools-call-invalid-args).
//
// Test jest GENERYCZNY: nie zna nazw tooli tego repo. Czyta `tools/list` z
// ZBUDOWANEGO serwera po stdio i z zadeklarowanego inputSchema sam generuje:
//   1. przypadek zlego TYPU dla kazdej wlasciwosci    -> oczekiwane invalid_args
//   2. brak pola wymaganego                            -> oczekiwane missing_arg
//   3. KONTROLE POZYTYWNA (komplet poprawnych typow)   -> NIE wolno odbic bramka
// Dzieki temu nowy tool jest objety testem automatycznie, bez dopisywania go tu.
//
// Kontrola pozytywna moze skonczyc sie bledem upstreamu (siec/403/brak wpisu) -
// to nie porazka: sprawdzamy wylacznie, ze zadanie PRZESZLO przez walidacje.
import { spawn } from "node:child_process";

const proc = spawn(process.execPath, ["dist/index.js"], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const waiters = new Map();
proc.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id && waiters.has(msg.id)) { waiters.get(msg.id)(msg); waiters.delete(msg.id); }
  }
});
let id = 0;
const send = (method, params) => new Promise((resolve) => {
  const myId = ++id;
  const timer = setTimeout(() => { waiters.delete(myId); resolve({ timeout: true }); }, 60000);
  waiters.set(myId, (m) => { clearTimeout(timer); resolve(m); });
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
});

const codeOf = (r) => r?.result?.structuredContent?.error_code ?? (r?.error ? "jsonrpc_error" : "OK");

// wartosc POPRAWNA wg zadeklarowanego typu (enum -> pierwsza dozwolona)
const validFor = (spec) => {
  if (Array.isArray(spec?.enum) && spec.enum.length) return spec.enum[0];
  switch (spec?.type) {
    case "string": return "test";
    case "number": case "integer": return 1;
    case "boolean": return true;
    case "array": return [];
    case "object": return {};
    default: return "test";
  }
};
// wartosc o ZLYM typie wzgledem zadeklarowanego. `type` bywa UNIA
// (np. ["string","number"]) - wtedy trzeba wybrac cos spoza CALEJ unii,
// inaczej "zly" przypadek jest w rzeczywistosci poprawny i test klamie.
const wrongFor = (spec) => {
  const types = Array.isArray(spec.type) ? spec.type : [spec.type];
  const candidates = [
    { v: 12345, t: ["number", "integer"] },
    { v: "not-a-number", t: ["string"] },
    { v: true, t: ["boolean"] },
    { v: [], t: ["array"] },
    { v: { nope: 1 }, t: ["object"] },
  ];
  for (const c of candidates) if (!c.t.some((x) => types.includes(x))) return c.v;
  return null;
};
const typeLabel = (spec) => (Array.isArray(spec.type) ? spec.type.join("|") : spec.type);

await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "conformance-test", version: "0" } });
proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const listed = await send("tools/list", {});
const tools = listed?.result?.tools ?? [];
if (!tools.length) { console.log("FAIL brak tooli w tools/list"); proc.kill(); process.exit(1); }
console.log(`tools/list -> ${tools.length} tooli`);

let fail = 0, checks = 0;
const report = (ok, label, got, want) => {
  checks++; if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} -> ${got}${ok ? "" : ` (oczekiwane ${want})`}`);
};

for (const tool of tools) {
  const props = tool.inputSchema?.properties ?? {};
  const required = tool.inputSchema?.required ?? [];
  const base = {};
  for (const r of required) base[r] = validFor(props[r]);

  // 1. zly typ na kazdej wlasciwosci z zadeklarowanym typem
  for (const [key, spec] of Object.entries(props)) {
    if (!spec?.type) continue;
    const bad = wrongFor(spec);
    if (bad === null) continue; // unia obejmuje wszystkie typy - nie ma czym sfalszowac
    const args = { ...base, [key]: bad };
    const got = codeOf(await send("tools/call", { name: tool.name, arguments: args }));
    report(got === "invalid_args", `${tool.name}: ${key} jako ${Array.isArray(bad) ? "array" : typeof bad} zamiast ${typeLabel(spec)}`, got, "invalid_args");
  }

  // 2. brak pola wymaganego
  if (required.length) {
    const args = { ...base }; delete args[required[0]];
    const got = codeOf(await send("tools/call", { name: tool.name, arguments: args }));
    report(got === "missing_arg", `${tool.name}: brak wymaganego '${required[0]}'`, got, "missing_arg");
  }

  // 3. kontrola pozytywna
  const got = codeOf(await send("tools/call", { name: tool.name, arguments: base }));
  const passed = got !== "invalid_args" && got !== "missing_arg";
  report(passed, `${tool.name}: KONTROLA POZYTYWNA (poprawne typy przechodza bramke)`, got, "cokolwiek poza invalid_args/missing_arg");
}

proc.kill();
console.log(fail === 0 ? `\nWYNIK: ${checks}/${checks} OK` : `\nWYNIK: ${fail} z ${checks} NIEPOWODZEN`);
process.exit(fail === 0 ? 0 : 1);
