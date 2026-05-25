#!/usr/bin/env node
// MCP server - Polish legislation (Dziennik Ustaw / Monitor Polski) via Sejm ELI API.
//
// Endpoint: https://api.sejm.gov.pl/eli
// Coverage: 96k+ aktow od 1918 do dzisiaj.
//
// Tooly:
//   - search_acts        - wyszukiwanie po tytule / roku / wydawcy / typie / statusie
//   - get_act            - szczegoly aktu po ELI (np. "DU/2018/1000")
//   - get_act_text       - tekst aktu (HTML lub link do PDF)
//   - search_by_eli      - skrot - lookup po ELI (alias get_act)
//
// structuredContent.citations:
//   { title, url, eli, display_address, publisher, year, type, status, in_force, promulgation }
//
// Razem z mcp-saos (powszechne) + mcp-nsa (administracyjne) + mcp-eu-sparql (UE)
// dopina pelna triade prawa polskiego dla Patrona.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

const BASE_URL = "https://api.sejm.gov.pl/eli";
const HTTP_TIMEOUT_MS = 30000;
const DEFAULT_USER_AGENT =
    "mcp-isap/1.0 (+https://github.com/matematicsolutions/mcp-isap)";

// Throttle 500ms - api.sejm.gov.pl jest tolerancyjne ale grzecznie.
const MIN_INTERVAL_MS = 500;
let lastRequestAt = 0;
async function throttled<T>(fn: () => Promise<T>): Promise<T> {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return fn();
}

async function apiGet<T>(path: string): Promise<T> {
    const url = `${BASE_URL}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            method: "GET",
            headers: {
                "User-Agent": DEFAULT_USER_AGENT,
                Accept: "application/json",
                "Accept-Language": "pl-PL,pl;q=0.9",
            },
            signal: controller.signal,
        });
        if (!res.ok) {
            throw new Error(`Sejm ELI API HTTP ${res.status} ${res.statusText}`);
        }
        return (await res.json()) as T;
    } finally {
        clearTimeout(timer);
    }
}

async function apiGetText(path: string): Promise<string> {
    const url = `${BASE_URL}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            method: "GET",
            headers: {
                "User-Agent": DEFAULT_USER_AGENT,
                Accept: "text/html,*/*",
                "Accept-Language": "pl-PL,pl;q=0.9",
            },
            signal: controller.signal,
        });
        if (!res.ok) {
            throw new Error(`Sejm ELI API HTTP ${res.status} ${res.statusText}`);
        }
        return await res.text();
    } finally {
        clearTimeout(timer);
    }
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

interface EliAct {
    address: string; // np. WDU20180001000
    ELI?: string; // np. DU/2018/1000
    displayAddress?: string; // np. "Dz.U. 2018 poz. 1000"
    title: string;
    type?: string; // Ustawa / Rozporzadzenie / ...
    publisher?: string; // DU / MP
    year?: number;
    pos?: number;
    promulgation?: string;
    announcementDate?: string;
    entryIntoForce?: string;
    status?: string;
    inForce?: string; // IN_FORCE / REPEALED / UNIFIED
    keywords?: string[];
    textHTML?: boolean;
    textPDF?: boolean;
}

interface EliSearchResponse {
    count: number;
    totalCount: number;
    offset: number;
    items: EliAct[];
}

function deriveEli(act: EliAct): string {
    if (act.ELI) return act.ELI;
    // Fallback: address = WDU20180001000 -> DU/2018/1000
    const m = act.address?.match(/^W?(DU|MP)(\d{4})0*(\d+)$/);
    if (m) return `${m[1]}/${m[2]}/${parseInt(m[3], 10)}`;
    if (act.publisher && act.year !== undefined && act.pos !== undefined) {
        return `${act.publisher}/${act.year}/${act.pos}`;
    }
    return act.address ?? "?";
}

function isapUiUrl(act: EliAct): string {
    const addr = act.address;
    if (addr) {
        return `https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=${encodeURIComponent(addr)}`;
    }
    const eli = deriveEli(act);
    return `https://isap.sejm.gov.pl/isap.nsf/ByKeyword.xsp?key=${encodeURIComponent(eli)}`;
}

// ---------------------------------------------------------------------------
// Citation builder
// ---------------------------------------------------------------------------

interface IsapCitation {
    title: string;
    url: string;
    snippet?: string;
    eli: string;
    display_address?: string;
    publisher?: string;
    year?: number;
    document_type?: string;
    status?: string;
    in_force?: string;
    promulgation?: string;
}

function buildCitation(act: EliAct): IsapCitation {
    const eli = deriveEli(act);
    return {
        title: act.title ?? eli,
        url: isapUiUrl(act),
        eli,
        ...(act.displayAddress && { display_address: act.displayAddress }),
        ...(act.publisher && { publisher: act.publisher }),
        ...(act.year !== undefined && { year: act.year }),
        ...(act.type && { document_type: act.type }),
        ...(act.status && { status: act.status }),
        ...(act.inForce && { in_force: act.inForce }),
        ...(act.promulgation && { promulgation: act.promulgation }),
    };
}

// ---------------------------------------------------------------------------
// Text formatters (human readable for LLM)
// ---------------------------------------------------------------------------

function formatList(args: {
    items: EliAct[];
    total: number;
    headline: string;
}): string {
    if (args.items.length === 0) {
        return (
            args.headline +
            "\n\nBrak wynikow. Sprobuj innego slowa w tytule, szerszego zakresu lat, " +
            "albo zmien publishera (DU = Dziennik Ustaw, MP = Monitor Polski)."
        );
    }
    const lines = [
        args.headline,
        `Znaleziono: ${args.total} aktow (pokazano ${args.items.length}).`,
        "",
    ];
    for (const act of args.items) {
        const eli = deriveEli(act);
        lines.push(`[${eli}] ${act.displayAddress ?? eli}`);
        lines.push(
            `  Typ : ${act.type ?? "?"} | Status: ${act.status ?? "?"} | ${act.inForce ?? "?"}`,
        );
        if (act.promulgation)
            lines.push(`  Data ogloszenia: ${act.promulgation}`);
        if (act.entryIntoForce)
            lines.push(`  Wejscie w zycie: ${act.entryIntoForce}`);
        lines.push(`  Tytul: ${act.title}`);
        lines.push(`  URL  : ${isapUiUrl(act)}`);
        lines.push("");
    }
    if (args.total > args.items.length) {
        lines.push(
            `[Wiecej wynikow: ${args.total - args.items.length}. Zwieksz limit lub zawez kryteria.]`,
        );
    }
    return lines.join("\n");
}

function formatActDetails(act: EliAct): string {
    const eli = deriveEli(act);
    const lines = [
        `=== AKT PRAWA POLSKIEGO - ${eli} ===`,
        "",
        `Tytul   : ${act.title ?? "?"}`,
        `ELI     : ${eli}`,
        `Adres   : ${act.displayAddress ?? "?"}`,
        `Typ     : ${act.type ?? "?"}`,
        `Status  : ${act.status ?? "?"}`,
        `Stan    : ${act.inForce ?? "?"}`,
    ];
    if (act.promulgation) lines.push(`Ogloszenie: ${act.promulgation}`);
    if (act.announcementDate)
        lines.push(`Data publ.: ${act.announcementDate}`);
    if (act.entryIntoForce)
        lines.push(`Wejscie : ${act.entryIntoForce}`);
    if (act.keywords?.length)
        lines.push(`Slowa klucz: ${act.keywords.join(", ")}`);
    lines.push("", `URL ISAP: ${isapUiUrl(act)}`);
    lines.push(
        `Tekst   : ${act.textHTML ? "HTML dostepny przez get_act_text" : "tylko PDF"}` +
            (act.textPDF ? ` | PDF: ${BASE_URL}/acts/${eli}/text.pdf` : ""),
    );
    return lines.join("\n");
}

function stripHtmlTags(s: string): string {
    return s
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, " ")
        .trim();
}

// ---------------------------------------------------------------------------
// Instructions (procedural orchestration) - wstrzykiwane przez Server.
// Drift test (test/drift.mjs) sprawdza spojnosc.
// Pattern z dograh-hq/dograh v1.31.0 (BSD-2) via mcp-eu-compliance v0.2.0.
// ---------------------------------------------------------------------------

const INSTRUCTIONS = `Ten serwer MCP udostepnia polska legislacje (Dziennik Ustaw + Monitor Polski) od 1918 - 96 000+ aktow przez oficjalne Sejm ELI API (api.sejm.gov.pl/eli). Identyfikator ELI (np. DU/2018/1000) jest stabilnym kluczem cytowalnosci.

## Kolejnosc wywolan

### Szukanie ustawy / rozporzadzenia
1. \`search_acts\` - po tytule (fragment, fleksja PL: "ochronie" znajdzie "o ochronie..."), roku, publisher (DU=Dziennik Ustaw, MP=Monitor Polski), typie aktu, statusie obowiazywania. Maks 50 wynikow.
2. \`get_act\` - po znalezieniu ELI (np. \`DU/2018/1000\`) pobierz metadane: tytul, typ, status, daty, slowa kluczowe, linki HTML/PDF/ISAP.
3. \`get_act_text\` - pelny tekst aktu HTML (pierwsze 5000 znakow czystego tekstu + link do pelnej tresci). Uzywaj zeby ocenic czy to wlasciwy akt.

## Twarde ograniczenia

- **Status aktu KLUCZOWY** - obowiazujacy / uchylony / wygasly musi byc w odpowiedzi koncowej. Cytowanie aktu uchylonego jako obowiazujacy = blad merytoryczny.
- **ELI w cytowaniach** - format \`PUBLISHER/YEAR/POSITION\` (np. DU/2018/1000) lub kompakt \`WDU20180001000\`. Bez ELI brak cytowalnosci.
- **Bez modyfikacji tresci** - tekst urzedowy integralny, NIE parafrazuj.
- **Tekst HTML nie zawsze dostepny** - dla starszych aktow (przed 2012 czesto) jest tylko PDF. \`get_act_text\` zwraca info + link do PDF.
- **\`structuredContent.citations\`**: title, url (isap.sejm.gov.pl), eli, status, in_force, type, promulgation_date. Cytuj w odpowiedzi.

## Iteracja po bledach

Tool zwraca \`isError: true\` + tekst z prefixem \`[code]\`. Typowe kody:
- \`missing_arg\` - brakujacy \`eli\` w get_act / get_act_text. Przeczytaj inputSchema.
- \`invalid_eli\` - format ELI nieprawidlowy. Wymagany "DU/2018/1000" lub "MP/2024/123" lub kompakt "WDU20180001000".
- \`not_found\` - akt o danym ELI nie ma w bazie. Sprobuj search_acts.
- \`upstream_error\` - blad Sejm ELI API. Retry raz przed surface do uzytkownika.

## Styl odpowiedzi

- Cytuj akty z ELI i statusem: "Ustawa o ochronie danych osobowych (DU/2018/1000, obowiazujaca)" lub "Ustawa z 1997 r. (DU/1997/133, uchylona przez DU/2018/1000)".
- Dla aktow z linii zmian (kolejne nowelizacje) wymien chronologicznie.
- NIE wymyslaj ELI - kazdy z \`structuredContent.citations\`.`;

const PUBLISHERS = ["DU", "MP"] as const;
const TYPES = [
    "Ustawa",
    "Rozporządzenie",
    "Obwieszczenie",
    "Uchwała",
    "Umowa międzynarodowa",
    "Konstytucja",
    "Postanowienie",
] as const;

const READ_ONLY_ANNOTATIONS = {
    readOnlyHint: true,
    idempotentHint: true,
    destructiveHint: false,
    openWorldHint: true, // upstream Sejm ELI API
} as const;

const TOOLS = [
    {
        name: "search_acts",
        annotations: READ_ONLY_ANNOTATIONS,
        description:
            "Wyszukiwanie aktow prawa polskiego (Dziennik Ustaw + Monitor Polski) przez " +
            "oficjalne Sejm ELI API. Pokrycie: 96 000+ aktow od 1918. " +
            "Filtry: fragment tytulu, rok, publisher (DU/MP), typ aktu, status obowiazywania. " +
            "Bledy: `upstream_error`.",
        inputSchema: {
            type: "object",
            properties: {
                title: {
                    type: "string",
                    description:
                        "Fragment tytulu (po polsku, z odmiana - np. 'ochronie' znajdzie 'ustawa o ochronie...').",
                },
                year: {
                    type: "number",
                    description: "Rok publikacji aktu.",
                    minimum: 1918,
                    maximum: 2100,
                },
                publisher: {
                    type: "string",
                    description:
                        "DU = Dziennik Ustaw (ustawy, rozporzadzenia), MP = Monitor Polski (uchwaly Sejmu, postanowienia Prezydenta, obwieszczenia).",
                    enum: ["DU", "MP"],
                },
                type: {
                    type: "string",
                    description: "Typ aktu (po polsku, dokladnie jak w bazie).",
                    enum: [...TYPES],
                },
                in_force: {
                    type: "boolean",
                    description:
                        "true = tylko obowiazujace akty. Pomin zeby objac wszystkie.",
                },
                limit: {
                    type: "number",
                    description: "Maks liczba wynikow (1-50). Domyslnie 10.",
                    minimum: 1,
                    maximum: 50,
                },
            },
            required: [],
        },
    },
    {
        name: "get_act",
        annotations: READ_ONLY_ANNOTATIONS,
        description:
            "Pobiera szczegoly aktu po identyfikatorze ELI (np. 'DU/2018/1000' dla " +
            "Ustawy o ochronie danych osobowych z 2018 r.). Zwraca pelne metadane: " +
            "tytul, typ, status obowiazywania, wejscie w zycie, slowa kluczowe, " +
            "linki do tekstu HTML/PDF i strony ISAP.",
        inputSchema: {
            type: "object",
            properties: {
                eli: {
                    type: "string",
                    description:
                        "Identyfikator ELI w formacie PUBLISHER/YEAR/POSITION, np. 'DU/2018/1000'.",
                },
            },
            required: ["eli"],
        },
    },
    {
        name: "get_act_text",
        annotations: READ_ONLY_ANNOTATIONS,
        description:
            "Pobiera tekst aktu w formacie HTML (jesli dostepny). Zwraca pierwsze " +
            "5000 znakow czystego tekstu (bez tagow) plus link do pelnego HTML/PDF. " +
            "Uzywaj po get_act zeby ocenic czy akt jest tym, czego szuka uzytkownik.",
        inputSchema: {
            type: "object",
            properties: {
                eli: {
                    type: "string",
                    description: "ELI aktu, np. 'DU/2018/1000'.",
                },
            },
            required: ["eli"],
        },
    },
] as const;

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

function parseEli(eli: string): {
    publisher: string;
    year: number;
    position: number;
} {
    // Akceptujemy "DU/2018/1000" lub "WDU20180001000" lub adres bez slasha
    const slashed = eli.match(/^(DU|MP)\/(\d{4})\/(\d+)$/i);
    if (slashed) {
        return {
            publisher: slashed[1].toUpperCase(),
            year: parseInt(slashed[2], 10),
            position: parseInt(slashed[3], 10),
        };
    }
    const compact = eli.match(/^W?(DU|MP)(\d{4})0*(\d+)$/i);
    if (compact) {
        return {
            publisher: compact[1].toUpperCase(),
            year: parseInt(compact[2], 10),
            position: parseInt(compact[3], 10),
        };
    }
    throw new Error(
        `Nieprawidlowy ELI: "${eli}". Wymagany format: "DU/2018/1000" albo "MP/2024/123".`,
    );
}

async function handleSearch(args: Record<string, unknown>) {
    const params = new URLSearchParams();
    if (typeof args.title === "string" && args.title.trim()) {
        params.set("title", args.title.trim());
    }
    if (typeof args.year === "number") {
        params.set("year", String(Math.floor(args.year)));
    }
    if (typeof args.publisher === "string") {
        params.set("publisher", args.publisher);
    }
    if (typeof args.type === "string") {
        params.set("type", args.type);
    }
    if (args.in_force === true) {
        params.set("inForce", "true");
    }
    const limit =
        typeof args.limit === "number"
            ? Math.min(50, Math.max(1, Math.floor(args.limit)))
            : 10;
    params.set("limit", String(limit));

    const path = `/acts/search?${params.toString()}`;
    const data = await throttled(() => apiGet<EliSearchResponse>(path));
    const items = data.items ?? [];
    return {
        content: [
            {
                type: "text",
                text: formatList({
                    items,
                    total: data.totalCount ?? items.length,
                    headline: `Wynik search_acts(${params.toString()}):`,
                }),
            },
        ],
        structuredContent: {
            citations: items.map(buildCitation),
        },
    };
}

// Strukturalne kody bledow - drift test asercja.
type ErrorCode = "missing_arg" | "invalid_eli" | "not_found" | "upstream_error";

function errorResult(text: string, code: ErrorCode) {
    return {
        content: [{ type: "text" as const, text: `[${code}] ${text}` }],
        structuredContent: { error_code: code },
        isError: true,
    };
}

async function handleGetAct(args: Record<string, unknown>) {
    if (typeof args.eli !== "string") {
        return errorResult("parametr 'eli' jest wymagany (np. 'DU/2018/1000').", "missing_arg");
    }
    let parsed;
    try {
        parsed = parseEli(args.eli);
    } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err), "invalid_eli");
    }
    const { publisher, year, position } = parsed;
    const path = `/acts/${publisher}/${year}/${position}`;
    const act = await throttled(() => apiGet<EliAct>(path));
    return {
        content: [{ type: "text", text: formatActDetails(act) }],
        structuredContent: {
            citations: [buildCitation(act)],
        },
    };
}

async function handleGetActText(args: Record<string, unknown>) {
    if (typeof args.eli !== "string") {
        return errorResult("parametr 'eli' jest wymagany (np. 'DU/2018/1000').", "missing_arg");
    }
    let parsed;
    try {
        parsed = parseEli(args.eli);
    } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err), "invalid_eli");
    }
    const { publisher, year, position } = parsed;
    // Najpierw metadane (zeby wiedziec czy textHTML jest dostepny + zbudowac citation)
    const meta = await throttled(() =>
        apiGet<EliAct>(`/acts/${publisher}/${year}/${position}`),
    );
    if (!meta.textHTML) {
        const lines = [
            `Tekst HTML dla ${deriveEli(meta)} nie jest dostepny przez API.`,
            "",
            meta.textPDF
                ? `Pobierz PDF: ${BASE_URL}/acts/${publisher}/${year}/${position}/text.pdf`
                : "Brak tekstu (PDF rowniez niedostepny).",
            "",
            `Strona ISAP (UI): ${isapUiUrl(meta)}`,
        ];
        return {
            content: [{ type: "text", text: lines.join("\n") }],
            structuredContent: { citations: [buildCitation(meta)] },
        };
    }
    const html = await throttled(() =>
        apiGetText(`/acts/${publisher}/${year}/${position}/text.html`),
    );
    const plain = stripHtmlTags(html);
    const preview = plain.slice(0, 5000);
    const lines = [
        `=== TEKST AKTU ${deriveEli(meta)} ===`,
        "",
        `Tytul: ${meta.title}`,
        `URL HTML: ${BASE_URL}/acts/${publisher}/${year}/${position}/text.html`,
        meta.textPDF
            ? `URL PDF : ${BASE_URL}/acts/${publisher}/${year}/${position}/text.pdf`
            : "",
        `Strona ISAP: ${isapUiUrl(meta)}`,
        "",
        `--- Tresc (pierwsze ${preview.length} znakow z ${plain.length} lacznie) ---`,
        preview,
    ].filter(Boolean);
    if (plain.length > preview.length) {
        lines.push(
            `[...] Skrocono. Pelny tekst: ${BASE_URL}/acts/${publisher}/${year}/${position}/text.html`,
        );
    }
    return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: { citations: [buildCitation(meta)] },
    };
}

// ---------------------------------------------------------------------------
// MCP Server setup
// ---------------------------------------------------------------------------

const server = new Server(
    { name: "mcp-isap", version: "1.1.0" },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: t.annotations,
    })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args ?? {}) as Record<string, unknown>;

    try {
        switch (name) {
            case "search_acts":
                return await handleSearch(a);
            case "get_act":
                return await handleGetAct(a);
            case "get_act_text":
                return await handleGetActText(a);
            default:
                return errorResult(`Nieznane narzedzie: ${name}`, "missing_arg");
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // 404 z API -> not_found, reszta -> upstream_error
        if (/404|not found/i.test(msg)) {
            return errorResult(`Akt nie znaleziony w Sejm ELI: ${msg}.`, "not_found");
        }
        return errorResult(
            `Blad komunikacji z Sejm ELI API: ${msg}. Sprobuj ponownie za chwile.`,
            "upstream_error",
        );
    }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write("mcp-isap server started (stdio transport)\n");
}

// Pomijamy uzycie zmiennych ktore moga byc nie referencowane, zeby uniknac warningow
void PUBLISHERS;

main().catch((err) => {
    process.stderr.write(`Fatal error: ${err}\n`);
    process.exit(1);
});
