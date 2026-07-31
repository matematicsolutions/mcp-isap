# AGENTS.md - mcp-isap

An [agents.md](https://agents.md) standard file (Linux Foundation / Agentic AI Foundation) - canonical instructions for AI agents working with this repository. Read natively by Cursor, Codex (OpenAI), Jules (Google), Devin / Windsurf, Aider, Amp, Factory, GitHub Copilot.

## Project goal

An **MCP (Model Context Protocol)** server for **Polish legislation** - **Dziennik Ustaw (Journal of Laws) + Monitor Polski** from 1918 (96k+ acts) - via the official **Sejm ELI API** (`api.sejm.gov.pl/eli`).

One of the 5 MateMatic Polish-law connectors ([`mcp-saos`](https://github.com/matematicsolutions/mcp-saos), [`mcp-nsa`](https://github.com/matematicsolutions/mcp-nsa), [`mcp-isap`](https://github.com/matematicsolutions/mcp-isap) (this one), [`mcp-krs`](https://github.com/matematicsolutions/mcp-krs), [`mcp-eu-sparql`](https://github.com/matematicsolutions/mcp-eu-sparql)).

## MateMatic context (HARD CONSTRAINTS)

The repo is maintained by [MateMatic Solutions](https://matematicsolutions.com). The connector is **trust infrastructure**.

- **Every tool call MUST return `structuredContent.citations`** with: the ELI identifier, act title, canonical URL (isap.sejm.gov.pl), entry-into-force date, status (in force / repealed).
- **Stateless** - no PII cache.
- **No content modification** of the act - the official text is integral.
- **Act status is critical** - "in force" / "repealed" / "expired" must be in the citation, otherwise the citation is misleading.

## MCP tools (tools contract)

| Tool | Key parameters | Returns |
|---|---|---|
| `search_acts` | `title?`, `year?`, `publisher?` (DU/MP), `type?`, `in_force?`, `limit?` | list of acts + citations |
| `get_act` | `eli` (ELI identifier) | act metadata + links to texts |
| `get_act_text` | `eli`, `page?` (1-based), `search_text?` | one 5000-character page of the act text, or the fragment around `search_text` |

Full description: `src/index.ts` + `README.md`.

### `get_act_text` - which point in time the text is from

Sejm ELI serves **the text as promulgated** under `text.html`. For a base act that is the
original wording, not the law in force: `DU/1964/93` (Civil Code) art. 118 still reads
"jednostkami gospodarki uspolecznionej" and a ten-year limitation period. The wording in
force lives in the newest consolidated-text announcement (`obwieszczenie`).

`structuredContent.text_version` states which one the caller got - `tekst_jednolity`,
`tekst_jednolity_nieaktualny`, `tekst_ogloszony_istnieje_nowszy_jednolity`,
`tekst_ogloszony` - and every variant except the first also carries a visible `[!] UWAGA`
block in the content. **Do not remove either signal**: without them the tool hands back
repealed wording that looks current.

Acts served only as PDF return `isError` with `text_unavailable_use_pdf`. That is not the
text of the provision - never present it as one.

## Build and test

```bash
npm install        # Node 20+
npm run build      # tsc -> dist/
npm start          # node dist/index.js
npm run dev        # ts-node src/index.ts
```

Test: `npx @modelcontextprotocol/inspector node dist/index.js`.

## Code rules

- **TypeScript strict**.
- **`@modelcontextprotocol/sdk` ^1.12.0**.
- **The Sejm ELI API is official** - we may call it normally, but we use a User-Agent with a MateMatic contact.
- **No Polish characters in commit messages**.
- **CHANGELOG bump on contract change**.

## What NOT to do (hard rules)

- **Do NOT omit act status** in the citation - a repealed act cited as in force = a substantive error.
- **Do NOT add tools from external legislation sources** (e.g. commercial consolidated texts) - the connector must be single-source ELI.
- **Do NOT modify the official text**.
- **Do NOT cache queries containing PII**.

## Sources of truth

1. [README.md](./README.md)
2. [CHANGELOG.md](./CHANGELOG.md)
3. `src/index.ts`
4. [Sejm ELI API documentation](https://api.sejm.gov.pl/eli/openapi/) - upstream
5. [ISAP - Internetowy System Aktow Prawnych](https://isap.sejm.gov.pl) - user frontend

## Agent compatibility

The [AGENTS.md](https://agents.md) standard. For Claude Code, additionally the [CLAUDE.md](./CLAUDE.md) file.

## License

**MIT** - see [LICENSE](./LICENSE).

Citation: *MateMatic Solutions (2026), mcp-isap - MCP server for Polish legislation (Sejm ELI / ISAP), https://github.com/matematicsolutions/mcp-isap, MIT.*
