# mcp-isap
[![MCP](https://img.shields.io/badge/MCP-Server-blue)](https://modelcontextprotocol.io) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE) [![Node](https://img.shields.io/badge/Node-18%2B-brightgreen)](https://nodejs.org)

MCP server dla **legislacji polskiej** — Dziennik Ustaw (DU) + Monitor Polski (MP)
przez oficjalne **Sejm ELI API** (`api.sejm.gov.pl/eli`).

## Po co

`mcp-saos` (powszechne) + `mcp-nsa` (administracyjne) + `mcp-eu-sparql` (UE)
ciemnij stronę. **`mcp-isap` dokłada legislację** — ustawy, rozporządzenia,
obwieszczenia, umowy międzynarodowe. To zamyka triadę:

```
USTAWA + ORZECZNICTWO + PRAWO UE
   ↓         ↓              ↓
  ISAP    SAOS+NSA      EUR-Lex
   ↓         ↓              ↓
        kancelaria pyta o RODO
        → 4 konektory równolegle
        → 4 sekcje cytatów w panelu
```

Pokrycie: **96 000+ aktów** od 1918 do dziś. Pełne wsparcie ELI
(European Legislation Identifier).

## Tooly

- **`search_acts(title?, year?, publisher?, type?, in_force?, limit?)`** —
  wyszukiwanie po fragmencie tytułu / roku / wydawcy / typie aktu /
  statusie obowiązywania. `publisher`: `DU` (Dziennik Ustaw) lub `MP`
  (Monitor Polski).
- **`get_act(eli)`** — szczegóły aktu po ELI (`DU/2018/1000`).
  Zwraca tytuł, typ, status, wejście w życie, słowa kluczowe,
  linki do tekstu HTML/PDF i strony ISAP.
- **`get_act_text(eli)`** — pierwsze 5000 znaków czystego tekstu aktu
  (bez tagów HTML) + link do pełnej wersji HTML/PDF.

Każda zwrotka zawiera `structuredContent.citations` z polami:
`title`, `url` (ISAP UI), `eli`, `display_address` (`Dz.U. 2018 poz. 1000`),
`publisher`, `year`, `document_type`, `status`, `in_force`, `promulgation`.

Patron czyta pole automatycznie i wystawia w panelu UI jako sekcję
**"Akty prawa polskiego (Dz.U. / M.P. — Sejm ELI)"**.

## Stack

- Node 18+ (wbudowany `fetch`)
- `@modelcontextprotocol/sdk`
- Stdio transport
- Throttle 500 ms między żądaniami (2 req/s)
- Zero scrapowania — czyste REST JSON API

## Build + uruchomienie

```bash
npm install
npm run build
node dist/index.js
```

## Wpięcie do Patrona

W `patron/backend/mcp-servers.json`:

```json
{
  "name": "isap",
  "transport": "stdio",
  "command": "node",
  "args": ["C:/Users/Wieslaw/mcp-isap/dist/index.js"],
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

Powinno zwrócić Ustawę o ochronie danych osobowych z 10 maja 2018,
status `IN_FORCE`, link do ISAP i strukturyzowany cytat.

## Lineage

Kontrakt API zaczerpnięty z [`legal-data-hunter/sources/PL/DziennikUrzedowy`](https://github.com/worldwidelaw/legal-sources)
(Python + REST, MIT). Implementacja TS od zera — bez importu kodu źródłowego.

## Licencja

MIT.
