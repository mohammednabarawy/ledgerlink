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

## Telegram API credentials

Telegram requires each user to register their own `api_id` and `api_hash` at [my.telegram.org/apps](https://my.telegram.org/apps). These identify the **app install** to Telegram — they do **not** share your chats with other users. You still sign in with your own phone number.

In LedgerLink, open **App Settings → Telegram** (gear icon in the title bar) and paste your credentials there. They are stored locally in your user data folder, never in the shipped app or git.

For local development only, you can optionally copy `.env.example` to `.env` as a fallback. Do not commit `.env`.

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
