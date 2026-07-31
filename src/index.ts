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
    // Lista plikow tresci: {type: "H"|"O"|"T"|"U"|"I", fileName}. Dla wielu aktow
    // (zwlaszcza obwieszczen z tekstem jednolitym) NIE ma pozycji "H" - jest tylko PDF.
    texts?: Array<{ fileName?: string; type?: string }>;
    // Klucze maja polskie znaki, m.in. "Inf. o tekscie jednolitym" (ten akt MA
    // nowszy tekst jednolity) i "Tekst jednolity dla aktu" (ten akt JEST tekstem
    // jednolitym innego). Wartosci: {id} albo {act:{ELI}} - zaleznie od endpointu.
    references?: Record<string, Array<{ id?: string; act?: { ELI?: string } }>>;
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

// --- Wersja tekstu i linki do PDF ------------------------------------------
// Sejm ELI serwuje pod /text.html TEKST OGLOSZONY danego aktu. Dla aktu bazowego
// (np. Kodeks cywilny DU/1964/93) jest to brzmienie z dnia ogloszenia - dla KC
// rok 1964 - a NIE stan obowiazujacy. Brzmienie aktualne siedzi w najnowszym
// obwieszczeniu z tekstem jednolitym. Bez tego rozroznienia tool zwraca tresc
// wygladajaca na aktualna i model cytuje uchylone brzmienie jako obowiazujace.

// Strona tresci. Kodeks ma ~400 tys. znakow - dotad tool oddawal SZTYWNO pierwsze
// 5000 i nie mowil, ze reszta istnieje, wiec art. 118 KC (znak ~40 tys.) byl
// nieosiagalny mimo "sukcesu". Teraz to jest jedna strona z N, z licznikiem.
const TEXT_PAGE_CHARS = 5000;

const REF_HAS_CONSOLIDATED = "Inf. o tek"; // prefiks - klucz ma polskie znaki
const REF_CONSOLIDATED_OF = "Tekst jednolity dla aktu";

const TEXT_TYPE_LABELS: Record<string, string> = {
    O: "tekst ogloszony",
    T: "tekst jednolity",
    U: "tekst ujednolicony",
    I: "tekst ogloszony (obraz)",
    H: "HTML",
};

function refIds(meta: EliAct, keyPrefix: string): string[] {
    const refs = meta.references;
    if (!refs) return [];
    const key = Object.keys(refs).find((k) => k.startsWith(keyPrefix));
    if (!key) return [];
    return (refs[key] ?? [])
        .map((e) => e?.id ?? e?.act?.ELI)
        .filter((v): v is string => typeof v === "string" && v.length > 0);
}

function pdfLinks(
    meta: EliAct,
    publisher: string,
    year: number,
    position: number,
): Array<{ label: string; url: string }> {
    const base = `${BASE_URL}/acts/${publisher}/${year}/${position}`;
    const out: Array<{ label: string; url: string }> = [];
    const seen = new Set<string>();
    if (meta.textPDF) {
        out.push({ label: "domyslny", url: `${base}/text.pdf` });
        seen.add(`${base}/text.pdf`);
    }
    for (const t of meta.texts ?? []) {
        if (!t?.fileName || !/\.pdf$/i.test(t.fileName)) continue;
        const url = `${base}/text/${t.type ?? "O"}/${t.fileName}`;
        if (seen.has(url)) continue;
        seen.add(url);
        out.push({ label: TEXT_TYPE_LABELS[t.type ?? ""] ?? `typ ${t.type}`, url });
    }
    return out;
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
3. \`get_act_text\` - tekst aktu, STRONAMI po 5000 znakow. Zeby dotrzec do konkretnego przepisu podaj \`search_text\` (np. "Art. 118.") - dostaniesz fragment wokol tej frazy jednym wywolaniem. Bez tego iteruj \`page\` (od 1) az \`pagination.has_more\` = false.

## Ktora to wersja tekstu (czytaj ZANIM zacytujesz)

Sejm ELI serwuje pod HTML **tekst ogloszony** danego aktu - czyli brzmienie z dnia ogloszenia, NIE stan na dzis.

- Akt bazowy (np. Kodeks cywilny DU/1964/93) zwraca brzmienie PIERWOTNE. Dla KC jest to tekst z 1964 r., w ktorym np. art. 118 mowi o "jednostkach gospodarki uspolecznionej" i terminie dziesieciu lat - brzmienie dawno nieobowiazujace.
- Brzmienie obowiazujace jest w najnowszym **obwieszczeniu z tekstem jednolitym**. Pole \`structuredContent.text_version\` mowi wprost, co dostales: tekst_jednolity (aktualny), tekst_jednolity_nieaktualny (byl tekstem jednolitym, ale wyszlo nowsze obwieszczenie - patrz \`superseded_by_eli\`), tekst_ogloszony_istnieje_nowszy_jednolity, tekst_ogloszony.
- Regula: pytanie o TRESC przepisu obowiazujacego -> najpierw najnowszy tekst jednolity, dopiero potem akt bazowy. Tylko \`text_version\` = tekst_jednolity przy \`in_force\` = IN_FORCE jest dowodem brzmienia na dzis. Pozostale warianty to material historyczny i kazdy z nich niesie widoczne ostrzezenie w tresci - przepisz je uzytkownikowi zamiast je pomijac.

## Twarde ograniczenia

- **Status aktu KLUCZOWY** - obowiazujacy / uchylony / wygasly musi byc w odpowiedzi koncowej. Cytowanie aktu uchylonego jako obowiazujacy = blad merytoryczny.
- **ELI w cytowaniach** - format \`PUBLISHER/YEAR/POSITION\` (np. DU/2018/1000) lub kompakt \`WDU20180001000\`. Bez ELI brak cytowalnosci.
- **Bez modyfikacji tresci** - tekst urzedowy integralny, NIE parafrazuj.
- **Tekst HTML nie zawsze istnieje** - czesc aktow (w tym swiezsze obwieszczenia z tekstem jednolitym) ma wylacznie PDF. Wtedy \`get_act_text\` zwraca BLAD \`text_unavailable_use_pdf\` z linkami do PDF - to nie jest tresc przepisu i nie wolno na tej podstawie twierdzic, jak przepis brzmi. Pobierz PDF poza tym konektorem albo powiedz uzytkownikowi, ze tresci nie masz.
- **\`structuredContent.citations\`**: title, url (isap.sejm.gov.pl), eli, status, in_force, type, promulgation_date. Cytuj w odpowiedzi.

## Iteracja po bledach

Tool zwraca \`isError: true\` + tekst z prefixem \`[code]\`. Typowe kody:
- \`missing_arg\` - brakujacy \`eli\` w get_act / get_act_text. Przeczytaj inputSchema.
- \`invalid_args\` - parametr ma zly TYP wobec inputSchema (np. year jako tekst, in_force jako string). Popraw typ i powtorz - to blad wywolania, nie zrodla.
- \`invalid_eli\` - format ELI nieprawidlowy. Wymagany "DU/2018/1000" lub "MP/2024/123" lub kompakt "WDU20180001000".
- \`not_found\` - akt o danym ELI nie ma w bazie ALBO fraza z \`search_text\` nie wystepuje w tekscie aktu. W drugim przypadku sprawdz pisownie z polskimi znakami - wyszukiwarka ISAP tez jest na nie wrazliwa ("postepowania" da 0 wynikow, "postÄ™powania" da komplet).
- \`text_unavailable_use_pdf\` - akt istnieje, ale jego tresci NIE MA w HTML (tylko PDF). Odpowiedz zawiera linki do PDF i ELI tekstow jednolitych do sprobowania. NIE traktuj tego jako braku przepisu ani nie zgaduj jego brzmienia.
- \`upstream_error\` - blad Sejm ELI API. Retry raz przed surface do uzytkownika.

## Styl odpowiedzi

- Cytuj akty z ELI i statusem: "Ustawa o ochronie danych osobowych (DU/2018/1000, obowiazujaca)" lub "Ustawa z 1997 r. (DU/1997/133, uchylona przez DU/2018/1000)".
- Dla aktow z linii zmian (kolejne nowelizacje) wymien chronologicznie.
- NIE wymyslaj ELI - kazdy z \`structuredContent.citations\`.`;

const PUBLISHERS = ["DU", "MP"] as const;
const TYPES = [
    "Ustawa",
    "RozporzÄ…dzenie",
    "Obwieszczenie",
    "UchwaĹ‚a",
    "Umowa miÄ™dzynarodowa",
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
            "Pobiera tekst aktu, stronami po 5000 znakow czystego tekstu. Odpowiedz " +
            "konczy sie licznikiem `[paginacja] strona N z M`, a `structuredContent." +
            "pagination` ma page/total_pages/has_more - iteruj `page` az has_more=false. " +
            "Zeby trafic w konkretny przepis bez przewijania, podaj `search_text` " +
            "(np. 'Art. 118.') - tool zwroci fragment wokol tej frazy. " +
            "UWAGA: dla aktu bazowego HTML to tekst OGLOSZONY (brzmienie pierwotne), " +
            "nie stan obowiazujacy - `structuredContent.text_version` to rozroznia. " +
            "Bledy: `text_unavailable_use_pdf` (akt ma tylko PDF), `not_found` " +
            "(brak frazy albo aktu), `invalid_eli`.",
        inputSchema: {
            type: "object",
            properties: {
                eli: {
                    type: "string",
                    description: "ELI aktu, np. 'DU/2018/1000'.",
                },
                page: {
                    type: "number",
                    description:
                        "Numer strony tekstu, liczony od 1 (5000 znakow na strone). Domyslnie 1.",
                    minimum: 1,
                },
                search_text: {
                    type: "string",
                    description:
                        "Fraza do znalezienia w tekscie aktu - zwraca fragment wokol pierwszego " +
                        "trafienia zamiast strony (np. 'Art. 118.'). Ma pierwszenstwo przed `page`. " +
                        "Wielkosc liter bez znaczenia, polskie znaki MAJA znaczenie.",
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
type ErrorCode =
    | "missing_arg"
    | "invalid_args"
    | "invalid_eli"
    | "not_found"
    | "upstream_error"
    | "text_unavailable_use_pdf";

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
    const page = typeof args.page === "number" ? Math.max(1, Math.floor(args.page)) : 1;
    const needle =
        typeof args.search_text === "string" && args.search_text.trim()
            ? args.search_text.trim()
            : null;

    // Najpierw metadane (czy jest HTML, ktora to wersja tekstu, citation).
    const meta = await throttled(() =>
        apiGet<EliAct>(`/acts/${publisher}/${year}/${position}`),
    );
    const eli = deriveEli(meta);
    const newerConsolidated = refIds(meta, REF_HAS_CONSOLIDATED);
    const consolidatedOf = refIds(meta, REF_CONSOLIDATED_OF);
    const pdfs = pdfLinks(meta, publisher, year, position);

    // Brak HTML = brak tresci przepisu. To MUSI byc blad, nie sukces z proza w
    // polu tresci: wywolujacy nie odroznial "przepis brzmi tak" od "nie mam tekstu"
    // i albo przyznawal brak danych, albo zaczynal zmyslac.
    const failUnavailable = (why: string) =>
        ({
            content: [
                {
                    type: "text" as const,
                    text:
                        `[text_unavailable_use_pdf] ${why} dla ${eli}. ` +
                        `Tresc tego aktu istnieje WYLACZNIE jako PDF - ten tool jej nie zwroci.\n\n` +
                        (pdfs.length
                            ? pdfs.map((p) => `PDF (${p.label}): ${p.url}`).join("\n")
                            : "Brak tekstu (PDF rowniez niedostepny).") +
                        (newerConsolidated.length
                            ? `\n\nTeksty jednolite tego aktu (sprobuj get_act_text na najnowszym): ` +
                              newerConsolidated.slice(0, 3).join(", ")
                            : "") +
                        `\n\nStrona ISAP (UI): ${isapUiUrl(meta)}`,
                },
            ],
            structuredContent: {
                error_code: "text_unavailable_use_pdf" as ErrorCode,
                citations: [buildCitation(meta)],
                text_available: false,
                text_format: "pdf",
                pdf_urls: pdfs.map((p) => p.url),
                consolidated_text_eli: newerConsolidated,
            },
            isError: true,
        });

    if (!meta.textHTML) return failUnavailable("Tekst HTML nie jest udostepniany przez API");

    const html = await throttled(() =>
        apiGetText(`/acts/${publisher}/${year}/${position}/text.html`),
    );
    const plain = stripHtmlTags(html);
    // HTTP 200 z pustym cialem zdarza sie na tym API - pusty tekst to brak tekstu.
    if (!plain) return failUnavailable("Endpoint text.html zwrocil pusta odpowiedz");

    const totalPages = Math.max(1, Math.ceil(plain.length / TEXT_PAGE_CHARS));
    let start: number;
    let mode: "page" | "fragment";
    let occurrences = 0;

    if (needle) {
        const hay = plain.toLowerCase();
        const nee = needle.toLowerCase();
        let idx = hay.indexOf(nee);
        if (idx < 0) {
            return errorResult(
                `Fraza "${needle}" nie wystepuje w tekscie aktu ${eli} ` +
                    `(${plain.length} znakow). Sprawdz pisownie (polskie znaki!) albo ` +
                    `przejrzyj tekst stronami: page=1..${totalPages}.`,
                "not_found",
            );
        }
        for (let i = idx; i >= 0; i = hay.indexOf(nee, i + 1)) occurrences++;
        start = Math.max(0, idx - 200); // kontekst przed trafieniem
        mode = "fragment";
    } else {
        start = Math.min((page - 1) * TEXT_PAGE_CHARS, (totalPages - 1) * TEXT_PAGE_CHARS);
        mode = "page";
    }

    const end = Math.min(start + TEXT_PAGE_CHARS, plain.length);
    const body = plain.slice(start, end);
    const currentPage = Math.floor(start / TEXT_PAGE_CHARS) + 1;
    const nextPage = end < plain.length ? Math.floor(end / TEXT_PAGE_CHARS) + 1 : null;

    const isConsolidated = consolidatedOf.length > 0;
    const outOfForce = meta.inForce !== undefined && meta.inForce !== "IN_FORCE";

    // Wygasly tekst jednolity to druga pulapka tej samej klasy: tresc jest
    // prawdziwa, ale to brzmienie sprzed kolejnego obwieszczenia. Nastepce
    // znajdziemy przez akt bazowy - jedno dodatkowe zapytanie, tylko w tej galezi.
    let supersededBy: string[] = [];
    if (isConsolidated && outOfForce) {
        try {
            const b = parseEli(consolidatedOf[0]);
            const baseMeta = await throttled(() =>
                apiGet<EliAct>(`/acts/${b.publisher}/${b.year}/${b.position}`),
            );
            supersededBy = refIds(baseMeta, REF_HAS_CONSOLIDATED).filter((x) => x !== eli);
        } catch {
            supersededBy = []; // best-effort - brak nastepcy nie kasuje ostrzezenia nizej
        }
    }

    const textVersion = isConsolidated
        ? outOfForce
            ? "tekst_jednolity_nieaktualny"
            : "tekst_jednolity"
        : newerConsolidated.length
          ? "tekst_ogloszony_istnieje_nowszy_jednolity"
          : "tekst_ogloszony";

    const lines = [
        `=== TEKST AKTU ${eli} (strona ${currentPage} z ${totalPages}) ===`,
        "",
        `Tytul : ${meta.title}`,
        `Status: ${meta.status ?? "?"} | Stan: ${meta.inForce ?? "?"}`,
        `Wersja tekstu: ${textVersion}`,
    ];
    if (textVersion === "tekst_ogloszony_istnieje_nowszy_jednolity") {
        lines.push(
            "",
            `[!] UWAGA - to jest tekst OGLOSZONY (brzmienie z dnia ogloszenia aktu, ` +
                `${meta.promulgation ?? "data nieznana"}), a NIE stan prawny na dzis. ` +
                `Akt byl nowelizowany. Brzmienie obowiazujace jest w najnowszym tekscie ` +
                `jednolitym: ${newerConsolidated.slice(0, 3).join(", ")}. ` +
                `NIE cytuj ponizszej tresci jako obowiazujacej bez sprawdzenia tam.`,
        );
    } else if (outOfForce) {
        lines.push(
            "",
            `[!] UWAGA - ten akt NIE OBOWIAZUJE (${meta.status ?? "?"} / ${meta.inForce}). ` +
                (supersededBy.length
                    ? `Nowszy tekst jednolity tej ustawy: ${supersededBy.slice(0, 3).join(", ")}. `
                    : "") +
                `Ponizsza tresc jest materialem historycznym - NIE cytuj jej jako stanu ` +
                `prawnego na dzis.`,
        );
    }
    lines.push(
        "",
        `URL HTML: ${BASE_URL}/acts/${publisher}/${year}/${position}/text.html`,
        ...pdfs.map((p) => `URL PDF (${p.label}): ${p.url}`),
        `Strona ISAP: ${isapUiUrl(meta)}`,
        "",
    );
    if (mode === "fragment") {
        lines.push(
            `--- Fragment wokol frazy "${needle}" ` +
                `(trafien w akcie: ${occurrences}, pokazano pierwsze; znaki ${start}-${end} z ${plain.length}) ---`,
        );
    } else {
        lines.push(`--- Tresc (znaki ${start}-${end} z ${plain.length}) ---`);
    }
    lines.push(body, "");
    lines.push(
        nextPage
            ? `[paginacja] strona ${currentPage} z ${totalPages} | has_more: true | ` +
                  `dalej: get_act_text(eli="${eli}", page=${nextPage})`
            : `[paginacja] strona ${currentPage} z ${totalPages} | has_more: false | koniec tekstu`,
    );

    return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: {
            citations: [buildCitation(meta)],
            text_available: true,
            text_version: textVersion,
            consolidated_text_eli: newerConsolidated,
            superseded_by_eli: supersededBy,
            pagination: {
                page: currentPage,
                total_pages: totalPages,
                total_chars: plain.length,
                char_start: start,
                char_end: end,
                has_more: nextPage !== null,
                next_page: nextPage,
            },
        },
    };
}

// ---------------------------------------------------------------------------
// MCP Server setup
// ---------------------------------------------------------------------------

// --- Walidacja argumentow wobec ZADEKLAROWANEGO inputSchema ---------------
// setRequestHandler(CallToolRequestSchema) ze SDK waliduje tylko KOPERTE zadania;
// pola `arguments` NIE sprawdza wobec inputSchema danego toola, wiec deklaracja
// schematu byla wylacznie dokumentacja dla modelu, bez egzekucji. Zewnetrzny audyt
// (Ahmad-Faraj/mcp-conformance, check `tools-call-invalid-args`) zlapal to na
// 4 konektorach floty.
// Zakres celowo waski: TYPY + pola WYMAGANE. `enum` NIE jest egzekwowany - dotad
// wartosc spoza listy szla do upstreamu i czasem dzialala, wiec zaostrzenie tego
// byloby zmiana zachowania szersza niz naprawiana wada (osobna decyzja).
// Nieznane pola przepuszczamy swiadomie (forward-compat ze starszymi klientami).
type JsonType = "string" | "number" | "integer" | "boolean" | "array" | "object";

function typeOk(v: unknown, t: JsonType): boolean {
    switch (t) {
        case "string":  return typeof v === "string";
        case "number":  return typeof v === "number" && Number.isFinite(v);
        case "integer": return typeof v === "number" && Number.isInteger(v);
        case "boolean": return typeof v === "boolean";
        case "array":   return Array.isArray(v);
        case "object":  return typeof v === "object" && v !== null && !Array.isArray(v);
        default:        return true;
    }
}

function describeType(v: unknown): string {
    if (Array.isArray(v)) return "array";
    if (v === null) return "null";
    return typeof v;
}

// Zwraca {msg, code} albo null. Kod rozrozniony celowo: BRAK pola wymaganego to
// nadal `missing_arg` (tak bylo przed ta zmiana i tak moga na to patrzec klienci),
// a `invalid_args` jest NOWE i dotyczy wylacznie zlego TYPU. Inaczej ta poprawka
// po cichu przemianowalaby istniejacy blad.
function validateArgs(
    toolName: string,
    args: Record<string, unknown>,
): { msg: string; code: ErrorCode } | null {
    const tool = TOOLS.find((t) => t.name === toolName);
    if (!tool) return null;
    const schema = tool.inputSchema as unknown as {
        properties?: Record<string, { type?: string | string[] }>;
        required?: readonly string[];
    };
    for (const req of schema.required ?? []) {
        if (args[req] === undefined || args[req] === null) {
            return { msg: `parametr '${req}' jest wymagany.`, code: "missing_arg" };
        }
    }
    for (const [key, val] of Object.entries(args)) {
        if (val === undefined || val === null) continue;
        const spec = schema.properties?.[key];
        if (!spec || !spec.type) continue;
        // `type` w JSON Schema moze byc UNIA (np. ["string","number"] w id).
        // Bez normalizacji takie pole wpadalo w `default: return true`, czyli
        // bylo ciche NIE-walidowane - zlapane przez generyczny test, nie przez
        // czytanie kodu.
        const types = (Array.isArray(spec.type) ? spec.type : [spec.type]) as JsonType[];
        if (!types.some((t) => typeOk(val, t))) {
            return {
                msg: `parametr '${key}' ma byc typu ${types.join(" | ")}, dostano ${describeType(val)}.`,
                code: "invalid_args",
            };
        }
    }
    return null;
}

const server = new Server(
    { name: "mcp-isap", version: "1.3.0" },
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

    // Bramka typow PRZED dispatchem - zeby zly typ konczyl sie czytelnym bledem
    // narzedzia, a nie zapytaniem do upstreamu ze smieciem w parametrze.
    const invalid = validateArgs(name, a);
    if (invalid) return errorResult(invalid.msg, invalid.code);

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
