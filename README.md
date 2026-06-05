<p align="center">
  <img src="public/ledgerlink_logo.png" width="88" alt="LedgerLink logo" />
</p>

<h1 align="center">LedgerLink</h1>

<p align="center">
  <strong>Archive WhatsApp &amp; Telegram chats into structured Obsidian vaults</strong><br/>
  Built for accountants, administrators, and anyone who needs searchable, local-first message archives.
</p>

<p align="center">
  <a href="https://github.com/mohammednabarawy/ledgerlink/releases/latest">
    <img src="https://img.shields.io/github/v/release/mohammednabarawy/ledgerlink?label=Download&style=for-the-badge" alt="Latest release" />
  </a>
  <img src="https://img.shields.io/badge/platform-Windows%20x64-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Windows x64" />
  <img src="https://img.shields.io/badge/Electron-42-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron" />
</p>

---

## Overview

LedgerLink is a desktop app that connects to **WhatsApp Web** and **Telegram**, lets you pick an **Obsidian vault**, and archives chats into clean monthly Markdown with linked media. It supports multiple local accounts, background watching, OCR, PDF scanning, and local voice/video transcription.

<p align="center">
  <img src="docs/screenshots/main-workspace.png" alt="LedgerLink main workspace — WhatsApp device linking screen" width="920" />
  <br/>
  <em>Main workspace — logged-out state (no personal chats shown)</em>
</p>

---

## Features

| Feature | Description |
|--------|-------------|
| **Dual platforms** | WhatsApp and Telegram in one desktop shell |
| **Obsidian export** | Monthly Markdown archives with attachments in vault folders |
| **Multi-account profiles** | Separate vaults, OCR defaults, and sessions per profile |
| **Auto-archive watcher** | Debounced background sync for new, edited, and revoked messages |
| **OCR** | Image and PDF text extraction (Tesseract) with English + Arabic |
| **Transcription** | Local whisper.cpp + ffmpeg for voice notes and video |
| **Bilingual UI** | English (LTR) and Arabic (RTL) with mirrored layout |
| **Privacy-first** | Sessions and API keys stay on your machine — never bundled in releases |

---

## Screenshots

All screenshots were captured in a **logged-out, demo state** — no real chats, contacts, or credentials are visible.

### Connected accounts & device linking

Switch between WhatsApp and Telegram from the sidebar. Link WhatsApp via QR or sign in to Telegram with your phone.

<p align="center">
  <img src="docs/screenshots/telegram-connect.png" alt="Telegram connect screen with API setup prompt" width="920" />
</p>

### Title bar accounts

Create and switch profiles from the title bar without cluttering the sidebar.

<p align="center">
  <img src="docs/screenshots/account-menu.png" alt="Title bar account menu" width="920" />
</p>

### App Settings

Vault path, OCR, transcription models, and Telegram API credentials — all in one place.

<table>
  <tr>
    <td width="50%">
      <img src="docs/screenshots/app-settings-vault.png" alt="App Settings — Obsidian vault tab" />
      <br/><sub><b>Obsidian Vault</b> — per-account storage path</sub>
    </td>
    <td width="50%">
      <img src="docs/screenshots/app-settings-telegram.png" alt="App Settings — Telegram API tab" />
      <br/><sub><b>Telegram API</b> — your own api_id &amp; api_hash</sub>
    </td>
  </tr>
</table>

---

## Download

**Windows x64 (installer):** [Latest release](https://github.com/mohammednabarawy/ledgerlink/releases/latest)

```
LedgerLink-1.0.0-Windows-x64-Setup.exe
```

> The installer is unsigned. Windows SmartScreen may show a warning on first run — choose *More info → Run anyway* if you trust the source.

---

## Getting started

1. **Install** LedgerLink from the [releases page](https://github.com/mohammednabarawy/ledgerlink/releases/latest).
2. **App Settings → Obsidian Vault** — choose the vault folder for your active account.
3. **App Settings → Telegram** — add your own [API ID and API Hash](https://my.telegram.org/apps) *(Telegram only; each user registers their own app)*.
4. **Connect** WhatsApp (scan QR) or Telegram (phone + verification code).
5. **Select a chat** in the sidebar list, then archive, review, repair, or enable the watcher.
6. **App Settings → Transcription** — download a Whisper model when you need voice/video transcription.

### Telegram API credentials

Telegram requires each user to register their own `api_id` and `api_hash` at [my.telegram.org/apps](https://my.telegram.org/apps). These identify **your app install** to Telegram — they do **not** share your chats with other users. You still sign in with your own phone number.

Open **App Settings → Telegram** (gear icon in the title bar) and paste your credentials. They are stored locally in `%APPDATA%\LedgerLink\`, never in the shipped installer or git.

---

## Technology stack

| Layer | Stack |
|-------|--------|
| Desktop | Electron 42 |
| Frontend | React 19, Vite, Tailwind CSS 4 |
| WhatsApp | whatsapp-web.js |
| Telegram | telegram (GramJS) |
| OCR | Tesseract.js, Sharp, pdf.js |
| Transcription | whisper.cpp, ffmpeg-static |
| Icons | Lucide React |

---

## Development

### Prerequisites

- Node.js 20+
- npm

### Run locally

```bash
npm install
npm run dev
```

`npm run dev` starts Vite and Electron together. WhatsApp and Telegram require the full Electron shell (not the browser preview alone).

### Build

```bash
npm run build          # Vite production bundle
npm run release:win    # Windows installer + safety scan
```

Output lands in `release/`. Whisper CPU binaries are bundled; GPU binaries and speech models are optional downloads.

### Optional dev fallback

For local development you may copy `.env.example` to `.env` with Telegram credentials. The installed app uses **App Settings** instead. Never commit `.env`.

---

## Privacy & data

| Data | Where it lives |
|------|----------------|
| WhatsApp session | `%APPDATA%\LedgerLink\WhatsAppAuth\` |
| Telegram session | `%APPDATA%\LedgerLink\TelegramSessions\` |
| Profiles & settings | `%APPDATA%\LedgerLink\profiles.json` |
| OCR language models | `%APPDATA%\LedgerLink\tesseract-models\` |
| Whisper models | `%APPDATA%\LedgerLink\whisper_models\` |
| Archived chats | Your chosen Obsidian vault |

Nothing in the [release installer](https://github.com/mohammednabarawy/ledgerlink/releases) contains your sessions, chats, or API keys.

---

## License

Private project — see repository owner for terms.
