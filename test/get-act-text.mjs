// Regresja get_act_text - klasa "cicha niekompletnosc" (sukces protokolarny bez danych).
//
// Wykryte przy weryfikacji pytan benchmarku PL/EU 2026-07-31: agent pytajacy o
// tresc art. 118 KC dostawal przez ten konektor komunikat zamiast przepisu, a
// odpowiedz wygladala na sukces. Trzy odrebne wady w jednym toolu:
//   1. brak HTML  -> sukces z proza "pobierz PDF" w polu tresci
//   2. sztywne 5000 znakow -> art. 118 (znak ~40 tys.) nieosiagalny, bez sladu
//      w odpowiedzi, ze reszta tekstu istnieje
//   3. tekst OGLOSZONY aktu bazowego podawany bez ostrzezenia jak stan prawny
//
// Test idzie po stdio na ZBUDOWANYM serwerze, z fixture zamiast sieci.
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { MARKERS } from "./fixtures.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// --import wymaga URL-a: na Windows sciezka z backslashami sie nie laduje.
const preload = pathToFileURL(join(here, "fixtures.mjs")).href;
const proc = spawn(
    process.execPath,
    ["--import", preload, join(here, "..", "dist", "index.js")],
    { stdio: ["pipe", "pipe", "pipe"] },
);
proc.stderr.on("data", (d) => {
    const s = d.toString();
    if (!s.includes("server started")) process.stderr.write(`[serwer] ${s}`);
});

let buf = "";
const waiters = new Map();
proc.stdout.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id && waiters.has(msg.id)) { waiters.get(msg.id)(msg); waiters.delete(msg.id); }
    }
});

let id = 0;
const send = (method, params) => new Promise((resolve) => {
    const myId = ++id;
    const timer = setTimeout(() => { waiters.delete(myId); resolve({ timeout: true }); }, 30000);
    waiters.set(myId, (m) => { clearTimeout(timer); resolve(m); });
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
});

const call = (args) => send("tools/call", { name: "get_act_text", arguments: args });
const textOf = (r) => (r?.result?.content ?? []).map((c) => c.text ?? "").join("\n");
const sc = (r) => r?.result?.structuredContent ?? {};

let fail = 0, checks = 0;
const check = (ok, label, detail = "") => {
    checks++; if (!ok) fail++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : ` -> ${detail}`}`);
};

await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "get-act-text-test", version: "0" },
});
proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

// --- 1. Brak HTML: blad, nie sukces z proza --------------------------------
{
    const r = await call({ eli: "DU/2026/795" });
    check(r?.result?.isError === true,
        "brak HTML -> isError=true (nie sukces z komunikatem w tresci)",
        `isError=${r?.result?.isError}`);
    check(sc(r).error_code === "text_unavailable_use_pdf",
        "brak HTML -> error_code=text_unavailable_use_pdf",
        `got ${sc(r).error_code}`);
    check(sc(r).text_available === false, "brak HTML -> text_available=false");
    check((sc(r).pdf_urls ?? []).some((u) => u.endsWith("D20260795L.pdf")),
        "brak HTML -> podaje link do PDF tekstu jednolitego");
}

// --- 2. Tekst jednolity: art. 118 osiagalny jednym wywolaniem --------------
{
    const r = await call({ eli: "DU/2024/1061", search_text: "Art. 118." });
    const t = textOf(r);
    check(!r?.result?.isError, "search_text -> nie blad");
    check(t.includes(MARKERS.ART_118_JEDNOLITY.slice(0, 80)),
        "search_text zwraca TRESC art. 118 z tekstu jednolitego (szesc lat)");
    check(sc(r).text_version === "tekst_jednolity",
        "tekst jednolity oznaczony jako tekst_jednolity", `got ${sc(r).text_version}`);
    check(sc(r).pagination?.total_pages > 1,
        "dlugi akt raportuje total_pages > 1 (a nie udaje, ze to caly tekst)");
}

// --- 3. Paginacja: strona 1 mowi, ze cos jest dalej ------------------------
{
    const r = await call({ eli: "DU/2024/1061" });
    const p = sc(r).pagination ?? {};
    check(p.page === 1 && p.has_more === true,
        "strona 1 dlugiego aktu ma has_more=true", JSON.stringify(p));
    check(textOf(r).includes("[paginacja]"),
        "tresc konczy sie czytelnym licznikiem stron");
    const r3 = await call({ eli: "DU/2024/1061", page: 3 });
    check(sc(r3).pagination?.page === 3, "page=3 zwraca strone 3",
        JSON.stringify(sc(r3).pagination));
    check(sc(r3).pagination?.char_start === 10000,
        "strony sa rozlaczne i przewidywalne (char_start = 10000)");
}

// --- 4. Akt bazowy: tresc + ostrzezenie, ze to brzmienie pierwotne ---------
{
    const r = await call({ eli: "DU/1964/93", search_text: "Art. 118." });
    const t = textOf(r);
    check(t.includes("dziesiec"), "akt bazowy zwraca brzmienie OGLOSZONE (1964)");
    check(sc(r).text_version === "tekst_ogloszony_istnieje_nowszy_jednolity",
        "akt bazowy oznaczony jako tekst ogloszony z nowszym jednolitym",
        `got ${sc(r).text_version}`);
    check((sc(r).consolidated_text_eli ?? []).includes("DU/2026/795"),
        "wskazuje ELI najnowszego tekstu jednolitego");
    check(/UWAGA/.test(t) && /NIE cytuj/.test(t),
        "ostrzezenie o nieaktualnym brzmieniu jest w widocznej tresci");
}

// --- 4b. Wygasly tekst jednolity: tresc prawdziwa, ale nie stan na dzis ----
{
    const r = await call({ eli: "DU/2023/1610" });
    check(sc(r).text_version === "tekst_jednolity_nieaktualny",
        "wygasly tekst jednolity nie jest oznaczony po prostu jako tekst_jednolity",
        `got ${sc(r).text_version}`);
    check((sc(r).superseded_by_eli ?? []).includes("DU/2026/795"),
        "wskazuje nastepce wygaslego tekstu jednolitego",
        JSON.stringify(sc(r).superseded_by_eli));
    check(/NIE OBOWIAZUJE/.test(textOf(r)),
        "ostrzezenie o nieobowiazywaniu jest w widocznej tresci");
}

// --- 5. Fraza nieobecna: jawny not_found, nie cicha strona 1 ---------------
{
    const r = await call({ eli: "DU/2024/1061", search_text: "Art. 99999." });
    check(r?.result?.isError === true && sc(r).error_code === "not_found",
        "nieobecna fraza -> not_found (nie cicha strona 1)", `got ${sc(r).error_code}`);
}

// --- 6. HTTP 200 z pustym cialem to brak tresci, nie pusty sukces ----------
{
    const r = await call({ eli: "DU/2000/999" });
    check(sc(r).error_code === "text_unavailable_use_pdf",
        "puste 200 na text.html -> text_unavailable_use_pdf", `got ${sc(r).error_code}`);
}

proc.kill();
console.log(fail === 0 ? `\nWYNIK: ${checks}/${checks} OK` : `\nWYNIK: ${fail} z ${checks} NIEPOWODZEN`);
process.exit(fail === 0 ? 0 : 1);
