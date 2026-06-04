# WhatsApp to Obsidian Archiver (Accountant Edition)

## Objective
A desktop application using Electron and `whatsapp-web.js` that securely connects to WhatsApp Web, allows the user to select an existing Obsidian Vault or create a new one, and archives selected group chats into an optimized file structure for easy search and retrieval by accountants.

## Obsidian Vault Integration
- **Vault Selection:** On initial launch (or via settings), the app will prompt the user to either:
  1. Select an existing Obsidian Vault directory on their local drive.
  2. Create a new folder to act as a new Obsidian Vault.
- The app will then save all exported data directly into this selected Vault folder.

## File Structure for Accountants
To ensure invoices, receipts, and important documents are easily retrievable without scrolling through endless chat logs, the archive for a specific group will be structured as follows:

```text
SelectedVault/
└── WhatsApp Archive/
    └── Group Name (or Contact Name)/
        ├── Chats/
        │   ├── 2023-10.md       # Chat messages grouped by month
        │   └── 2023-11.md       # Prevents a single massive file
        ├── Documents/           # PDFs, Word Docs, Spreadsheets
        ├── Media/               # Images and Videos
        └── Audio/               # Voice Notes
```

## Tagging & Markdown Formatting
Every message saved to the monthly `.md` files will include metadata to leverage Obsidian's powerful search:
- **Timestamp & Sender:** `**[2023-10-25 14:30] John Doe:**`
- **Text:** The message text.
- **Attachments:** If a message contains a file, it will be saved to the respective folder (`Documents`, `Media`, etc.) and linked via Obsidian's embed syntax: `![[invoice_123.pdf]]`
- **Automated Tags:** 
  - `#invoice` / `#document` (for PDFs, Word files)
  - `#image` / `#video` (for media)
  - `#voicenote` (for audio files)
  - `#sender/John_Doe` (to easily filter all files sent by a specific person)

This means you can go into Obsidian and simply search `tag:#invoice tag:#sender/John_Doe` to instantly see every invoice John Doe ever sent in that group.

## Tech Stack
- **Electron:** Desktop wrapper and filesystem access.
- **Vite + React:** Frontend UI for QR code scanning, Vault selection, and Chat selection.
- **whatsapp-web.js:** Headless browser automation for WhatsApp Web.
- **Tailwind CSS:** Modern UI styling.
