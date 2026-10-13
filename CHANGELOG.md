# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) +
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.2] - 2026-10-13

Aktualizacja zaleznosci (bezpieczenstwo). Bez zmian w kodzie serwera i w kontrakcie narzedzi.

### Security

- `npm audit`: 6 doradztw (1 krytyczne, 2 wysokie, 3 srednie) -> 0. Zadna paczka nie doszla ani nie zniknela (porownanie zbiorow z lockfile'a); `@modelcontextprotocol/sdk` -> 1.32.1 i jego zaleznosci transportow HTTP (hono, proxy-addr, qs, ip-address, fast-uri i inne).
- Ekspozycja przed poprawka (zderzone z kodem): serwer uzywa wylacznie `StdioServerTransport` - zaleznosci HTTP SDK nie sa ladowane; doradztwo SDK dotyczy KLIENTA OAuth. Realna ekspozycja bliska zera - aktualizacja, bo tania i bez zmiany wersji glownej SDK.
- Weryfikacja: build, wszystkie bramki offline, zywy smoke 3/3 narzedzi na Sejm ELI.

## [1.4.1] - 2026-10-13

Wydanie 1.4.0 zostalo otagowane, ale NIE trafilo na npm: bramka paczki dostala pusta liste z `npm pack --dry-run --json`, bo npm 12 (runner z `npm install -g npm@latest`) oddaje obiekt kluczowany nazwa paczki zamiast tablicy - i slusznie zablokowala (pusta lista = BLOKADA). 1.4.1 = tresc 1.4.0 + poprawka parsera.

### Fixed

- Bramka paczki: `plikiZPack` rozumie oba formaty `npm pack --json` (npm <= 11: tablica, npm 12: obiekt); nieznany ksztalt nadal = pusta lista = BLOKADA. Testy obu formatow + kontrola na prawdziwym wyjsciu npm 12.

## [1.4.0] - 2026-10-13

Odpornosc na ciche awarie (wzorce z oceny soba-labs/krs-mcp i leniwyposel/sejm-mcp, retrofit
z mcp-saos, 2026-10-13). Wersja minor: kody bledow sa rozdzielone (konkretniejsze niz `upstream_error`), ale zaden znany konsument nie rozgalezia sie na nich - PATRON czyta tylko `isError`, prawo-pl-mcp opakowuje bledy konektora we wlasny `upstream_error` (sprawdzone 2026-10-13).
addytywne (nowe pole `provenance`). Kody bledow ROZDZIELONE (patrz Fixed) - klient branchujacy na
`upstream_error` dostanie teraz konkretniejszy kod. Opisy narzedzi (tools/list) bez zmian -
`tools.lock.json` przechodzi.

### Fixed

- **Zapora przed API Sejmu** (HTTP 200 + HTML "Request Rejected"): `apiGet` robil `res.json()` bez sprawdzenia typu - blad parsera wychodzil jako `upstream_error` "sprobuj ponownie"; `apiGetText` przyjmowal strone zapory JAKO TEKST AKTU. Teraz `upstream_blocked` z numerem wsparcia (sygnatura tresci na `text.html`, gdzie HTML jest legalny).
- **Nieznany ksztalt wyszukiwania**: `data.items ?? []` zamienial JSON 200 w innym ukladzie w "Brak wynikow". Teraz `upstream_shape`; HTML/inny typ zamiast JSON i uszkodzony JSON - tez `upstream_shape`.
- **Kod bledu ustalany regexem `/404|not found/` po tresci komunikatu** - teraz po statusie HTTP w warstwie zrodla: 404/410 -> `not_found`, 401/403 -> `forbidden` (bez ponawiania, przeglad czlowieka), 429/5xx/timeout/siec -> `upstream_unavailable`, inny status -> `upstream_error`, wyjatek spoza zrodla -> `internal_error` (zamiast "Blad komunikacji z Sejm ELI API, sprobuj ponownie").
- **Nastepca wygaslego tekstu jednolitego**: `catch { supersededBy = [] }` - nieudane sprawdzenie aktu bazowego wygladalo jak "brak nastepcy". Teraz `structuredContent.superseded_by_status` (`ok` / `unavailable` / `not_checked`) i zdanie w ostrzezeniu "nie udalo sie sprawdzic ... brak nastepcy NIE jest potwierdzony" (pole addytywne).
- Test: `test/odpornosc.test.mjs` (E2E przez MCP na atrapie, 7 czerwonych przed poprawkami + kontrole pozytywne).

### Added

- `structuredContent.provenance` w kazdym udanym wyniku: `source` (URL-e Sejm ELI, ktore konektor odpytal - w `get_act_text` takze `text.html` i ewentualnie akt bazowy), `retrieved_at`, `source_produced_at: null` (jawnie - nie zgadujemy), `processing` (wzorzec soba-labs/krs-mcp, warunki ponownego wykorzystania ISP).
- `SEJM_ELI_BASE_URL` (env) - testy E2E na lokalnej atrapie Sejm ELI przez protokol MCP i prawdziwe HTTP (`test/e2e-atrapa.test.mjs`, `npm run test:e2e`); atrapa podaje odpowiedzi z `test/fixtures.mjs`, ksztalt `/acts/search` zmierzony na zywo. Test provenance z pelnym mianownikiem: `tools/list` == klucze wywolan, pusta lista = BLOKADA.
- Zywy smoke `npm run smoke` (`test/smoke.mjs`) - repo go nie mialo: kazde narzedzie z `tools/list` wywolane na zywym Sejm ELI, provenance, nieistniejacy akt -> `not_found`. Celowo poza CI i wydaniem.
- Bramka paczki `npm run test:package` (`npm pack --dry-run --json`; wymagane pliki wyprowadzone z `bin`/`main` + przechodnich `require`/`import` w `dist/`, pusta lista = BLOKADA).
- `release.yml`: krok "Run gates before publishing" (`npm test`, e2e, descriptor lock, bramka paczki) - do tej pory wydanie szlo bez zadnego testu. `ci.yml`: e2e + bramka paczki.

## [1.3.0] - 2026-07-31

Fixes a **silent-incompleteness** class in `get_act_text`: the tool used to return
protocol success with no legal content, or with content from the wrong point in time.
Found while verifying PL/EU benchmark questions - an agent asking for the wording of
art. 118 of the Civil Code got a message instead of the provision, and the response
looked like a success.

### Fixed

- **No HTML available is now an error, not prose in the content field.** For acts served
  only as PDF (many recent consolidated-text announcements, e.g. `DU/2026/795`) the tool
  returned `{"content": "Tekst HTML ... nie jest dostepny. Pobierz PDF: ..."}` **without**
  `isError`. A caller could not tell "the provision reads X" from "I have no text". Now:
  new error code **`text_unavailable_use_pdf`**, `structuredContent.text_available: false`,
  and `pdf_urls` per text type (ogloszony / jednolity / ujednolicony) built from the act's
  own `texts` list.
- **HTTP 200 with an empty body counts as no text.** `text.html` answers 200 with zero
  bytes for acts that have no HTML; that now takes the same error path instead of
  returning an empty success.
- **The 5000-character cut is gone.** The tool returned a hard-truncated first 5000
  characters and never said the rest existed, so art. 118 of the Civil Code (character
  ~40 000 of ~388 000) was unreachable. Text is now paginated with a visible
  `[paginacja] strona N z M` footer and `structuredContent.pagination`
  (page / total_pages / total_chars / char_start / char_end / has_more / next_page).

### Added

- **`page`** (1-based) and **`search_text`** on `get_act_text`. `search_text` returns the
  fragment around the first hit, so a specific article takes one call instead of paging.
  A phrase that does not occur returns `not_found` rather than silently falling back to
  page 1.
- **`text_version` - which point in time the text is from.** Sejm ELI serves the text
  **as promulgated** under `text.html`. For a base act that means the original wording:
  `DU/1964/93` art. 118 still reads "jednostkami gospodarki uspolecznionej" and a
  ten-year limitation period - repealed wording, previously returned with nothing marking
  it as historical. Values: `tekst_jednolity`, `tekst_jednolity_nieaktualny` (superseded
  by a newer announcement - see `superseded_by_eli`),
  `tekst_ogloszony_istnieje_nowszy_jednolity`, `tekst_ogloszony`. Every variant except the
  first also carries a visible `[!] UWAGA` block in the content, plus
  `consolidated_text_eli` with the ELI of the consolidated texts to use instead.
- `test/get-act-text.mjs` + `test/fixtures.mjs` - 21 offline regression checks over MCP
  stdio against frozen ELI responses (no network). Covers all three defects above and the
  200-with-empty-body case. Wired into CI as `npm run test:act-text`; `npm test` now runs
  drift + conformance + this.

### Fixed (tests)

- **The drift test was half dead.** `INSTRUCTIONS` is a template literal, so every backtick
  in it is escaped (`` \` ``); the reference-check regex expected bare backticks and matched
  **zero** identifiers. "OK drift" was asserting nothing about tool references. The escaping
  is now normalised before matching, error codes are excluded from the tool check, and an
  empty match set is itself a failure - so the check cannot go quiet again.

### Notes

- No PDF-to-text fallback: extracting PDF text would mean a heavy dependency and a new
  silent-failure surface. The tool now says clearly that it does not have the text and
  where the PDF is - the caller decides.
- Contract change on the error path (`isError` where there used to be success), hence the
  minor bump. `package.json`, `server.json` and the `serverInfo` literal bumped together.

## [1.2.0] - 2026-07-28

### Added

- **Argument type validation against the declared `inputSchema`.** The SDK's
  `setRequestHandler(CallToolRequestSchema, ...)` validates only the request envelope, never
  the `arguments` payload, so a tool declaring ``year` as a number` happily accepted the wrong type and
  forwarded the garbage downstream. A gate now runs before dispatch and rejects type
  mismatches with the new `invalid_args` error code. Union types (`type: ["string","number"]`)
  are normalised, so such properties are validated instead of silently skipped.
- New error code **`invalid_args`** (wrong argument *type*). A *missing* required argument
  still returns `missing_arg`, exactly as before - the two cases are deliberately kept apart
  so this change does not silently rename an existing error.
- `test/invalid-args.mjs` - generic conformance test. It reads `tools/list` from the built
  server over real MCP stdio and derives the cases from the declared schema, so a new tool is
  covered automatically. 13 checks: wrong type per property, missing required, plus a
  positive control proving well-typed calls still reach the upstream.

### Notes

- Found by an external audit: `Ahmad-Faraj/mcp-conformance`, check `tools-call-invalid-args`.
- `enum` values are intentionally **not** enforced - out-of-enum values currently reach the
  upstream and sometimes work, so tightening that is a behaviour change wider than the defect
  being fixed.
- Released as 1.2.0: `package.json`, `server.json` and the `serverInfo` literal in
  `src/index.ts` bumped together. `serverInfo` had drifted behind the published version,
  so the handshake reported an older release than npm actually served.

## [1.1.0] — 2026-05-25

Retrofit do kanonu MCP MateMatic (pattern z dograh-hq/dograh v1.31.0, BSD-2). Backward-compatible.

### Added

- `instructions` w Server (procedural orchestration: kolejnosc, status aktu kluczowy, ELI cytowalnosc, HTML/PDF dostepnosc, iteracja po bledach).
- `ToolAnnotations` per tool (`readOnlyHint`, `openWorldHint=true` bo Sejm ELI API live).
- Strukturalne `ErrorCode`: `missing_arg`, `invalid_eli`, `not_found`, `upstream_error`. Format `[code] tekst` + `structuredContent.error_code`.
- Walidacja formatu ELI przed wyslaniem do upstream (PUBLISHER/YEAR/POSITION lub kompakt).
- Routing HTTP 404 -> `not_found` (lepsza wskazowka dla LLM niz generyczny upstream_error).
- Drift test (`npm run drift`).

## [1.0.0] — 2026-05-20

Initial public release.

Polish legislation: Dziennik Ustaw + Monitor Polski via official Sejm ELI JSON API. 96k+ acts since 1918. 3 tools: search_acts / get_act / get_act_text.

### Highlights

- Node 18+ stdio MCP server, single `dist/index.js` entry.
- LIVE smoke-tested on real data.
- `structuredContent.citations` consumed by [Patron](https://github.com/matematicsolutions/patron)
  and any other MCP-aware legal agent.
- MIT license, 500 ms request throttle, zero secrets required.

[1.0.0]: https://github.com/matematicsolutions/mcp-isap/releases/tag/v1.0.0
