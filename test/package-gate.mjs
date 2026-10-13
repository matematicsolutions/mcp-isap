#!/usr/bin/env node
// Bramka paczki: to, co pojdzie na npm, musi dac sie uruchomic.
//
// Wzorzec soba-labs/krs-mcp #7 (`scripts/check-package.mjs:3-13`): `npm pack --dry-run --json`
// i asercja, ze pliki runtime naprawde sa w paczce. U nas wymagane pliki NIE sa sztywna lista:
// wyprowadzamy je z `bin` + przechodnich importow wzglednych w dist/, wiec nowy modul, ktorego
// zabraknie w paczce, zatrzyma wydanie zamiast wywalic serwer u uzytkownika na pierwszym
// `require`. Dzis mcp-isap to jeden modul (dist/index.js, CommonJS z tsc); bramka jest ta sama
// co w mcp-saos, zeby drugi plik w src/ byl objety bez dopisywania go tutaj.
//
// Run: npm run test:package   (eksport `sprawdzPaczke` testuje test/package-gate.test.mjs)

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Pliki wymagane w runtime: punkty wejscia z `bin`/`main` + przechodnie importy wzgledne. */
export function wymagane(root, pkg) {
  const wejscia = new Set();
  if (typeof pkg.bin === "string") wejscia.add(pkg.bin);
  else for (const v of Object.values(pkg.bin ?? {})) wejscia.add(v);
  if (pkg.main) wejscia.add(pkg.main);
  const kolejka = [...wejscia].map((p) => posix.normalize(p));
  const wynik = new Set(["package.json"]);
  while (kolejka.length) {
    const p = kolejka.pop();
    if (wynik.has(p)) continue;
    wynik.add(p);
    const pelna = join(root, p);
    if (!existsSync(pelna)) continue; // brak na dysku zglosi porownanie z lista paczki
    const src = readFileSync(pelna, "utf-8");
    // ESM (`from "./x.js"`, `import("./x.js")`) i CommonJS (`require("./x.js")` - tak buduje tsc tutaj)
    for (const m of src.matchAll(/(?:from\s+|import\s*\(|require\s*\()\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      kolejka.push(posix.normalize(posix.join(posix.dirname(p), m[1])));
    }
  }
  return wynik;
}

/** Trojstan: OK / BLOKADA (+ powody). Pusta lista plikow paczki = BLOKADA, nie sukces. */
export function sprawdzPaczke(plikiPaczki, potrzebne) {
  const powody = [];
  if (!plikiPaczki.length) powody.push("npm pack zwrocil PUSTA liste plikow");
  if (!potrzebne.size) powody.push("nie wyznaczono zadnego pliku wymaganego (bin/main?)");
  const jest = new Set(plikiPaczki);
  for (const p of potrzebne) if (!jest.has(p)) powody.push(`brak w paczce: ${p}`);
  return { status: powody.length ? "BLOKADA" : "OK", powody };
}

function main() {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const out = execFileSync(npm, ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: ROOT,
    encoding: "utf-8",
    shell: process.platform === "win32",
  });
  const pliki = (JSON.parse(out)[0]?.files ?? []).map((f) => f.path.replace(/\\/g, "/"));
  const potrzebne = wymagane(ROOT, pkg);
  const { status, powody } = sprawdzPaczke(pliki, potrzebne);
  if (status === "OK") {
    console.log(`package-gate: OK (${potrzebne.size} wymaganych z ${pliki.length} w paczce)`);
    process.exit(0);
  }
  console.error(`package-gate: BLOKADA\n  - ${powody.join("\n  - ")}`);
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
