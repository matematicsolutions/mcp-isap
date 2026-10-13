#!/usr/bin/env node
// Zywy smoke mcp-isap (api.sejm.gov.pl/eli) - zbudowany serwer po stdio, PRAWDZIWE zrodlo.
//
//   1. tools/list                      -> niepusta lista
//   2. search_acts / get_act / get_act_text na zywym Sejm ELI -> tresc + citations + provenance
//   3. nieistniejacy akt (404 "Act not found", zmierzone 2026-10-13) -> not_found
//   4. pelny mianownik: kazde narzedzie z tools/list wywolane na zywo
//      (wzorzec leniwyposel/sejm-mcp #7). Pusta lista = BLOKADA.
//
// Celowo POZA ci.yml i release.yml: awaria zrodla nie blokuje naszego wydania.
// Usage: npm run build && npm run smoke

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ZRODLO = "https://api.sejm.gov.pl/eli";

const env = { ...process.env };
delete env.SEJM_ELI_BASE_URL; // smoke ma bic w zywe zrodlo, nie w atrape
const c = new Client({ name: "smoke", version: "1.0" });
await c.connect(
    new StdioClientTransport({
        command: process.execPath,
        args: [join(ROOT, "dist", "index.js")],
        env,
        stderr: "ignore",
    }),
);

const failures = [];
const check = (ok, msg) => {
    console.log(`${ok ? "OK  " : "FAIL"} ${msg}`);
    if (!ok) failures.push(msg);
};
const wywolane = new Set();
const call = (name, args) => {
    wywolane.add(name);
    return c.callTool({ name, arguments: args });
};
const tekst = (r) => r?.content?.[0]?.text ?? "";
const prov = (r, nazwa, fragment) => {
    const p = r?.structuredContent?.provenance ?? {};
    check(
        String(p.source).includes(fragment) &&
            !Number.isNaN(Date.parse(p.retrieved_at)) &&
            p.source_produced_at === null &&
            (p.processing ?? "").length > 10,
        `${nazwa}: provenance (${JSON.stringify(p.source)})`,
    );
};

try {
    const zarejestrowane = (await c.listTools()).tools.map((t) => t.name).sort();
    check(zarejestrowane.length > 0, `tools/list -> ${zarejestrowane.join(", ")}`);

    const s = await call("search_acts", { title: "ochronie danych osobowych", publisher: "DU", limit: 5 });
    check(!s.isError, "search_acts bez isError");
    check((s.structuredContent?.citations ?? []).length > 0, `search_acts citations: ${s.structuredContent?.citations?.length}`);
    prov(s, "search_acts", `${ZRODLO}/acts/search?`);

    const a = await call("get_act", { eli: "DU/2018/1000" });
    check(!a.isError, "get_act bez isError");
    check(/ochronie danych osobowych/i.test(tekst(a)), "get_act DU/2018/1000 = ustawa o ochronie danych osobowych");
    prov(a, "get_act", `${ZRODLO}/acts/DU/2018/1000`);

    const t = await call("get_act_text", { eli: "DU/2018/1000", search_text: "Art. 1." });
    if (t.isError && t.structuredContent?.error_code === "text_unavailable_use_pdf") {
        check(false, "get_act_text DU/2018/1000: brak HTML (text_unavailable_use_pdf) - zmien akt w smoke");
    } else {
        check(!t.isError, `get_act_text bez isError ${t.isError ? tekst(t).slice(0, 120) : ""}`);
        check(/Art\. 1\./.test(tekst(t)), "get_act_text zawiera Art. 1.");
        check(typeof t.structuredContent?.text_version === "string", `text_version: ${t.structuredContent?.text_version}`);
        prov(t, "get_act_text", `${ZRODLO}/acts/DU/2018/1000/text.html`);
    }

    const brak = await call("get_act", { eli: "DU/2018/999999" });
    check(
        brak.isError === true && brak.structuredContent?.error_code === "not_found",
        `get_act(DU/2018/999999) -> ${brak.structuredContent?.error_code}`,
    );

    const bezPrzypadku = zarejestrowane.filter((n) => !wywolane.has(n));
    check(
        zarejestrowane.length > 0 && bezPrzypadku.length === 0,
        `narzedzia z przypadkiem zywym: ${zarejestrowane.filter((n) => wywolane.has(n)).length}/${zarejestrowane.length}` +
            (bezPrzypadku.length ? ` (brak: ${bezPrzypadku.join(", ")})` : ""),
    );
} catch (err) {
    failures.push(String(err));
    console.error("FAIL", err);
} finally {
    await c.close();
}

if (failures.length === 0) {
    console.log("\nOK smoke - wszystkie asercje live przeszly.");
    process.exit(0);
}
console.error(`\nFAIL smoke - ${failures.length} problemow.`);
process.exit(1);
