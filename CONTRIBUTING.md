# Contributing to LedgerLink

Thank you for your interest in LedgerLink. Contributions help make archiving WhatsApp and Telegram chats into Obsidian better for everyone using the app personally.

## Before you start

- Read the [LICENSE](LICENSE). By contributing, you agree that your contributions will be licensed under the **MIT License**.
- Do **not** commit secrets: `.env`, API keys, session files, real chat exports, or screenshots containing personal data.
- Search [existing issues](https://github.com/mohammednabarawy/ledgerlink/issues) before opening a duplicate.

## Ways to contribute

| Type | How |
|------|-----|
| **Bug reports** | Open an issue with steps to reproduce, expected vs actual behavior, and LedgerLink version |
| **Feature ideas** | Open an issue describing the problem and your proposed solution |
| **Code** | Fork, branch, open a pull request against `main` |
| **Docs & screenshots** | Improve README or use [demo mode](README.md#screenshot-demo-mode) with fictional data only |
| **Translations** | Extend `src/translations.js` (English and Arabic today) |

## Development setup

```bash
git clone https://github.com/mohammednabarawy/ledgerlink.git
cd ledgerlink
npm install
npm run dev
```

- `npm run dev` — Vite + Electron (full app)
- `npm run build` — production frontend bundle
- `npm run release:win` — Windows installer (maintainers)

See [README — Development](README.md#development) for demo URLs, build notes, and privacy details.

## Pull request guidelines

1. **Scope** — One logical change per PR (feature, fix, or docs).
2. **Style** — Match surrounding code: naming, imports, and minimal diffs.
3. **Privacy** — No real user chats, phone numbers, or credentials in code, tests, or images.
4. **Screenshots** — Use `?demo=workspace` (and other [demo scenes](README.md#screenshot-demo-mode)) or logged-out states only.
5. **Description** — Explain what changed and why; note how you tested on Windows if relevant.

## Commit messages

Use clear, imperative subjects:

```
Add Telegram settings validation for empty API hash
Fix vault path display when profile has no vault
Update README screenshots with demo workspace
```

## Code review

Maintainers may request changes before merge. Be patient and responsive — we’re a small project and reviews are done in spare time.

## Questions

- **Bugs & features:** [GitHub Issues](https://github.com/mohammednabarawy/ledgerlink/issues)

We appreciate every issue, doc fix, and pull request. Welcome aboard.
