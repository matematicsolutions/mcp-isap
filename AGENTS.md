# AGENTS.md - mcp-isap

Plik standardu [agents.md](https://agents.md) (Linux Foundation / Agentic AI Foundation) - kanoniczne instrukcje dla agentow AI pracujacych z tym repozytorium. Czytany natywnie przez Cursor, Codex (OpenAI), Jules (Google), Devin / Windsurf, Aider, Amp, Factory, GitHub Copilot.

## Cel projektu

Serwer **MCP (Model Context Protocol)** dla **polskiej legislacji** - **Dziennik Ustaw + Monitor Polski** od 1918 (96k+ aktow) - przez oficjalne **API Sejm ELI** (`api.sejm.gov.pl/eli`).

Jeden z 5 konektorow polskiego prawa MateMatic ([`mcp-saos`](https://github.com/matematicsolutions/mcp-saos), [`mcp-nsa`](https://github.com/matematicsolutions/mcp-nsa), [`mcp-isap`](https://github.com/matematicsolutions/mcp-isap) (ten), [`mcp-krs`](https://github.com/matematicsolutions/mcp-krs), [`mcp-eu-sparql`](https://github.com/matematicsolutions/mcp-eu-sparql)).

## Kontekst MateMatic (TWARDE OGRANICZENIA)

Repo prowadzi [MateMatic Solutions](https://matematicsolutions.com). Konektor jest **infrastruktura zaufania**.

- **Kazde wywolanie narzedzia MUSI zwracac `structuredContent.citations`** z: identyfikatorem ELI, tytulem aktu, URL kanonicznym (isap.sejm.gov.pl), datą wejscia w zycie, statusem (obowiazujacy / uchylony).
- **Stateless** - bez cache PII.
- **Bez modyfikacji tresci** aktu - tekst urzedowy jest integralny.
- **Status aktu jest kluczowy** - "obowiazujacy" / "uchylony" / "wygasly" musi byc w citation, inaczej cytowanie wprowadza w blad.

## Narzedzia MCP (tools contract)

| Tool | Parametry kluczowe | Zwraca |
|---|---|---|
| `search_acts` | `query`, `publisher?` (DU/MP), `year_from?`, `year_to?` | lista aktow + citations |
| `get_act` | `eli` (identyfikator ELI) | metadata aktu + linki do tekstow |
| `get_act_text` | `eli`, `format?` (html/pdf) | pelny tekst aktu w wybranym formacie |

Pelny opis: `src/index.ts` + `README.md`.

## Build i test

```bash
npm install        # Node 20+
npm run build      # tsc -> dist/
npm start          # node dist/index.js
npm run dev        # ts-node src/index.ts
```

Test: `npx @modelcontextprotocol/inspector node dist/index.js`.

## Zasady kodu

- **TypeScript strict**.
- **`@modelcontextprotocol/sdk` ^1.12.0**.
- **API Sejm ELI jest oficjalne** - mozemy uderzac normalnie, ale uzywamy User-Agent z kontaktem MateMatic.
- **Bez polskich znakow w commit messages**.
- **CHANGELOG bump przy zmianie kontraktu**.

## Czego NIE robic (twarde reguly)

- **NIE pomijaj statusu aktu** w citation - akt uchylony cytowany jako obowiazujacy = blad merytoryczny.
- **NIE dodawaj tools z zewnetrznych zrodel legislacji** (np. konsolidowane teksty komercyjne) - konektor ma byc single-source ELI.
- **NIE modyfikuj tekstu urzedowego**.
- **NIE cachuj zapytan z PII**.

## Zrodla prawdy

1. [README.md](./README.md)
2. [CHANGELOG.md](./CHANGELOG.md)
3. `src/index.ts`
4. [API Sejm ELI dokumentacja](https://api.sejm.gov.pl/eli/openapi/) - upstream
5. [ISAP - Internetowy System Aktow Prawnych](https://isap.sejm.gov.pl) - frontend uzytkownika

## Kompatybilnosc agentow

Standard [AGENTS.md](https://agents.md). Dla Claude Code dodatkowo plik [CLAUDE.md](./CLAUDE.md).

## Licencja

**MIT** - patrz [LICENSE](./LICENSE).

Cytowanie: *MateMatic Solutions (2026), mcp-isap - MCP server dla polskiej legislacji (Sejm ELI / ISAP), https://github.com/matematicsolutions/mcp-isap, MIT.*
