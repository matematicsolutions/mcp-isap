# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) +
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
