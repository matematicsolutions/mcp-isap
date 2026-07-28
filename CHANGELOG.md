# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) +
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
