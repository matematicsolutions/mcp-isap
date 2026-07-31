#!/usr/bin/env node
// Drift test - INSTRUCTIONS spojne z TOOLS i typem ErrorCode.
// Pattern z dograh v1.31.0 (BSD-2) via mcp-eu-compliance v0.2.0.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, "..", "src", "index.ts"), "utf-8");

const failures = [];

// Kody bledow czytamy PRZED sekcja tooli - referencja do kodu w INSTRUCTIONS nie
// jest referencja do toola, a bez tej listy check nizej oskarzalby `not_found`
// o bycie nieistniejacym toolem.
const errorCodeMatch = SRC.match(/type ErrorCode\s*=\s*([^;]+);/);
const declaredCodes = new Set(
    errorCodeMatch ? [...errorCodeMatch[1].matchAll(/"(\w+)"/g)].map((m) => m[1]) : [],
);

const instructionsMatch = SRC.match(/const INSTRUCTIONS = `([\s\S]*?)`;/);
if (!instructionsMatch) {
    failures.push("Nie znaleziono const INSTRUCTIONS w src/index.ts");
} else {
    // W zrodle INSTRUCTIONS to template literal, wiec kazdy backtick jest
    // ZAESCAPOWANY (\`tool\`). Bez tego kroku regex ponizej nie trafial NIGDY i
    // caly check referencji byl cicho martwy - "OK drift" nie znaczylo nic.
    const instructions = instructionsMatch[1].replace(/\\`/g, "`");

    const toolsBlock = SRC.match(/const TOOLS\s*=\s*\[([\s\S]*?)\]\s*as const;|const TOOLS\s*=\s*\[([\s\S]*?)\];/);
    const toolsSource = toolsBlock ? (toolsBlock[1] || toolsBlock[2] || "") : SRC;
    const toolsMatches = [...toolsSource.matchAll(/name:\s*"([a-z][a-z0-9_]+)"/g)];
    const registered = new Set(toolsMatches.map((m) => m[1]));

    const skip = new Set([
        "isError", "true", "false", "null", "undefined", "structuredContent",
        // nazwy pol kontraktu, nie toole
        "search_text", "text_version", "consolidated_text_eli", "text_available",
        "has_more", "total_pages", "in_force", "display_address", "error_code",
        "superseded_by_eli", "pdf_urls", "text_format",
    ]);
    const referenced = new Set();
    for (const m of instructions.matchAll(/`([a-z][a-z0-9_]{3,})`/g)) {
        if (!skip.has(m[1]) && !declaredCodes.has(m[1])) referenced.add(m[1]);
    }
    if (referenced.size === 0) {
        // Zero trafien znaczy, ze regex przestal pasowac do zrodla - to nie jest
        // "wszystko OK", to jest zepsuty test. Dokladnie ta klasa co bug, ktory
        // ten konektor naprawia: sukces bez danych.
        failures.push(
            "Check referencji nie wykryl ZADNEJ nazwy w backtickach - regex nie pasuje " +
                "juz do formatu INSTRUCTIONS. Test nic nie sprawdza.",
        );
    }

    for (const ref of referenced) {
        const looksLikeTool = ref.includes("_") || registered.has(ref);
        if (!looksLikeTool) continue;
        if (!registered.has(ref)) {
            failures.push(
                `INSTRUCTIONS referencuje tool '${ref}' ktorego nie ma w TOOLS. ` +
                    `Registered: ${[...registered].sort().join(", ")}`,
            );
        }
    }
}

const typeMatch = SRC.match(/type ErrorCode\s*=\s*([^;]+);/);
if (!typeMatch) {
    failures.push("Nie znaleziono type ErrorCode w src/index.ts");
} else {
    const codesInType = new Set();
    for (const m of typeMatch[1].matchAll(/"(\w+)"/g)) codesInType.add(m[1]);

    const instructionsText = instructionsMatch ? instructionsMatch[1] : "";
    for (const code of codesInType) {
        const docPattern = new RegExp("\\b" + code + "\\b");
        if (!docPattern.test(instructionsText)) {
            failures.push(
                `ErrorCode '${code}' w typie TS nie jest udokumentowany w INSTRUCTIONS.`,
            );
        }
    }

    for (const m of SRC.matchAll(/errorResult\([^,)]+,\s*"(\w+)"\)/g)) {
        if (!codesInType.has(m[1])) {
            failures.push(
                `errorResult uzywa kodu '${m[1]}' ktorego nie ma w typie ErrorCode.`,
            );
        }
    }
}

if (failures.length === 0) {
    console.log("OK drift - INSTRUCTIONS i ErrorCode spojne z TOOLS i kodem.");
    process.exit(0);
}

console.error("FAIL drift - znaleziono " + failures.length + " problemow:");
for (const f of failures) console.error("  - " + f);
process.exit(1);
