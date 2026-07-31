# mcp-isap

## Installation (one command)

Published on npm + MCP Registry (`io.github.matematicsolutions/mcp-isap`). Run without cloning:

```bash
npx -y @matematicsolutions/mcp-isap
```

MCP client configuration (stdio):

```json
{ "mcpServers": { "mcp-isap": { "command": "npx", "args": ["-y", "@matematicsolutions/mcp-isap"] } } }
```

(Building from source - below.)

[![MCP](https://img.shields.io/badge/MCP-Server-blue)](https://modelcontextprotocol.io) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE) [![Node](https://img.shields.io/badge/Node-18%2B-brightgreen)](https://nodejs.org)

MCP server for **Polish legislation** - Dziennik Ustaw (Journal of Laws, DU) + Monitor Polski (MP)
via the official **Sejm ELI API** (`api.sejm.gov.pl/eli`).

## Why

`mcp-saos` (general courts) + `mcp-nsa` (administrative) + `mcp-eu-sparql` (EU)
cover the case-law side. **`mcp-isap` adds legislation** - statutes, regulations,
official announcements, international agreements. This closes the triad:

```
STATUTE + CASE LAW + EU LAW
   ↓         ↓          ↓
  ISAP    SAOS+NSA   EUR-Lex
   ↓         ↓          ↓
        law firm asks about GDPR
        → 4 connectors in parallel
        → 4 citation sections in the panel
```

Coverage: **96,000+ acts** from 1918 to today. Full ELI support
(European Legislation Identifier).

## Tools

- **`search_acts(title?, year?, publisher?, type?, in_force?, limit?)`** -
  search by title fragment / year / publisher / act type /
  in-force status. `publisher`: `DU` (Dziennik Ustaw) or `MP`
  (Monitor Polski).
- **`get_act(eli)`** - act details by ELI (`DU/2018/1000`).
  Returns title, type, status, entry into force, keywords,
  links to HTML/PDF text and the ISAP page.
- **`get_act_text(eli, page?, search_text?)`** - the act's plain text (no HTML
  tags), paginated at 5000 characters per page. Iterate `page` while
  `structuredContent.pagination.has_more` is true, or pass `search_text`
  (e.g. `"Art. 118."`) to get the fragment around the first hit in one call.
  `structuredContent.text_version` says whether this is a consolidated text or
  the wording **as promulgated** - Sejm ELI serves the original wording for base
  acts, so for the law in force fetch the newest consolidated-text announcement
  listed in `consolidated_text_eli`. Acts published only as PDF return the
  `text_unavailable_use_pdf` error with links, never prose standing in for the
  provision.

Every response includes `structuredContent.citations` with fields:
`title`, `url` (ISAP UI), `eli`, `display_address` (`Dz.U. 2018 poz. 1000`),
`publisher`, `year`, `document_type`, `status`, `in_force`, `promulgation`.

Patron reads this field automatically and renders it in the UI panel as the section
**"Polish legal acts (Dz.U. / M.P. - Sejm ELI)"**.

## Stack

- Node 18+ (built-in `fetch`)
- `@modelcontextprotocol/sdk`
- Stdio transport
- 500 ms throttle between requests (2 req/s)
- No scraping - pure REST JSON API

## Build + run

```bash
npm install
npm run build
node dist/index.js
```

## Wiring into Patron

In `patron/backend/mcp-servers.json`:

```json
{
  "name": "isap",
  "transport": "stdio",
  "command": "node",
  "args": ["C:/Users/<YOUR-USER>/mcp-isap/dist/index.js"],
  "enabled": true
}
```

## Smoke test

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"s","version":"0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_act","arguments":{"eli":"DU/2018/1000"}}}' \
  | node dist/index.js
```

Should return the Personal Data Protection Act of 10 May 2018,
status `IN_FORCE`, a link to ISAP and a structured citation.

## Lineage

API contract derived from [`legal-data-hunter/sources/PL/DziennikUrzedowy`](https://github.com/worldwidelaw/legal-sources)
(Python + REST, MIT). TS implementation from scratch - no source code imported.

## License

MIT.

## Part of the MateMatic legal stack

This server is one of five MCP connectors covering Polish jurisdiction +
EU law, used by [Patron](https://github.com/matematicsolutions/patron)
(AGPL-3.0) and any other MCP-aware legal AI agent.

- **mcp-isap** (this repo) - Polish legislation (Dz.U. + M.P. via Sejm ELI)
- [mcp-saos](https://github.com/matematicsolutions/mcp-saos) - common courts, SN, TK, KIO
- [mcp-nsa](https://github.com/matematicsolutions/mcp-nsa) - NSA + 16 WSA administrative courts
- [mcp-krs](https://github.com/matematicsolutions/mcp-krs) - Polish company registry (KRS)
- [mcp-eu-sparql](https://github.com/matematicsolutions/mcp-eu-sparql) - EU law + CJEU (EUR-Lex)


All five MCP servers share the same `structuredContent.citations`
contract: each tool returns an array of `{title, url, snippet?, ...metadata}`
that legal agents can render directly in their citation panel.

See [matematicsolutions/.github](https://github.com/matematicsolutions)
for the full org profile.
