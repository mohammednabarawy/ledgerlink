# LedgerLink (Accountant Edition)

LedgerLink is a professional-grade desktop application built with Electron, React, and `whatsapp-web.js` that securely connects to WhatsApp Web, allowing users to select an Obsidian Vault and archive group or contact chats into a highly structured, search-optimized structure for accounting and administrative purposes.

## Key Features

- **Smart Archiving**: Organizes messages and links attachments (PDFs, Word documents, media, and voice notes) directly into Obsidian vaults.
- **Auto-Archive Watcher**: Actively watches selected chats in the background for new messages, edits, and revokes, updating your Obsidian Vault automatically with a debounced queuing mechanism.
- **Archive Repair**: Restructures historical monthly Markdown archives sequentially by timestamp to correct historical duplicates or ordering issues.
- **In-App Chat Viewer**: View your live WhatsApp message history and profile avatars directly inside the desktop console.
- **Bilingual Layout**: Full English (LTR) and Arabic (RTL) support with dynamic logical mirroring.

## Technology Stack

- **Core**: Electron, Vite, React (V19)
- **WhatsApp API**: `whatsapp-web.js`
- **Styling**: Tailwind CSS
- **Icons**: Lucide React

## Secrets and Telegram API

Telegram requires an `api_id` and `api_hash` from [my.telegram.org/apps](https://my.telegram.org/apps). These are **never** stored in git or in profile files on disk.

1. Copy the example env file:
   ```bash
   cp .env.example .env
   ```
   On Windows (PowerShell): `Copy-Item .env.example .env`

2. Edit `.env` and set:
   ```
   TELEGRAM_API_ID=your_api_id
   TELEGRAM_API_HASH=your_api_hash
   ```

`.env` is listed in `.gitignore`. Do not commit it. If credentials were ever pushed to a remote, rotate them at my.telegram.org.

## Development

Install dependencies:
```bash
npm install
```

Start the application in development mode:
```bash
npm run dev
```

Build the production bundle:
```bash
npm run build
```
