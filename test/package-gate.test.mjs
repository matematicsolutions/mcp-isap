// Kontrola pozytywna bramki paczki: musi zatrzymac paczke bez pliku runtime.
// Run: npm run test:e2e (wymaga npm run build)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { wymagane, sprawdzPaczke, plikiZPack } from "./package-gate.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));

test("wymagane: bin/main z dist/", () => {
  const w = wymagane(ROOT, pkg);
  for (const p of ["package.json", "dist/index.js"]) {
    assert.ok(w.has(p), `brak ${p} w wymaganych: ${[...w].join(", ")}`);
  }
});

test("wymagane: przechodni require() CommonJS (tak buduje tsc w tym repo)", () => {
  const d = mkdtempSync(join(tmpdir(), "isap-gate-"));
  try {
    mkdirSync(join(d, "dist"));
    writeFileSync(join(d, "dist", "index.js"), 'const x = require("./eli.js");\nrequire("https");\n');
    writeFileSync(join(d, "dist", "eli.js"), "module.exports = {};\n");
    const w = wymagane(d, { bin: { x: "dist/index.js" }, main: "dist/index.js" });
    assert.ok(w.has("dist/eli.js"), [...w].join(", "));
    assert.ok(!w.has("https"), "modul wbudowany nie jest plikiem paczki");
    const r = sprawdzPaczke(["package.json", "dist/index.js"], w);
    assert.equal(r.status, "BLOKADA");
    assert.ok(r.powody.some((p) => p.includes("dist/eli.js")));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("paczka bez dist/index.js -> BLOKADA z nazwa pliku", () => {
  const w = wymagane(ROOT, pkg);
  const r = sprawdzPaczke([...w].filter((p) => p !== "dist/index.js"), w);
  assert.equal(r.status, "BLOKADA");
  assert.ok(r.powody.some((p) => p.includes("dist/index.js")));
});

test("pusta lista plikow paczki = BLOKADA, nie sukces", () => {
  assert.equal(sprawdzPaczke([], wymagane(ROOT, pkg)).status, "BLOKADA");
});

test("kompletna paczka = OK", () => {
  const w = wymagane(ROOT, pkg);
  assert.deepEqual(sprawdzPaczke([...w, "README.md"], w), { status: "OK", powody: [] });
});

// npm 12 zmienil format `npm pack --json` (obiekt zamiast tablicy) - 2026-10-13 bramka dostala
// pusta liste na runnerze z npm@latest i zablokowala wydanie. Oba ksztalty musza dzialac.
test("plikiZPack: format npm <= 11 (tablica)", () => {
  assert.deepEqual(plikiZPack([{ files: [{ path: "dist/index.js" }, { path: "package.json" }] }]), ["dist/index.js", "package.json"]);
});

test("plikiZPack: format npm 12 (obiekt kluczowany nazwa paczki)", () => {
  const npm12 = { "@matematicsolutions/x": { name: "@matematicsolutions/x", files: [{ path: "dist/index.js" }, { path: "package.json" }] } };
  assert.deepEqual(plikiZPack(npm12), ["dist/index.js", "package.json"]);
});

test("plikiZPack: nieznany ksztalt -> pusta lista (czyli BLOKADA w sprawdzPaczke)", () => {
  assert.deepEqual(plikiZPack(null), []);
  assert.deepEqual(plikiZPack("x"), []);
});
