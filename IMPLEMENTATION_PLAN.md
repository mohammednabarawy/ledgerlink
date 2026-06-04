# WhatsApp Archiver Reliability Implementation Plan

## Investigation Summary

Current code confirms all four reported issues are real:

- Re-running an archive can place new/backfilled messages in the wrong position. `electron/archiver.js` skips already processed IDs and writes each new message with `fs.appendFileSync(...)`, so any older WhatsApp message that appears after the first archive is appended to the bottom of its month file instead of inserted by timestamp.
- Existing affected Markdown files are not repairable from the current state alone if they only contain rendered blocks and `archive_state.json` only stores `processedIds`. The repair needs either a fresh WhatsApp fetch or a richer manifest of message metadata.
- The app has no watcher service. `electron/main.js` registers WhatsApp auth/status handlers but no `message`, `message_create`, `message_revoke_*`, `message_edit`, or `message_reaction` listeners.
- The UI intentionally hides non-group chats. `src/App.jsx` filters `getChats()` with `chatList.filter(c => c.isGroup)`, even though `electron/main.js` already returns every chat.
- There is no in-app original chat viewer. The renderer can list chats and trigger archive/import, but there is no IPC endpoint to fetch a chat stream and no secondary Electron window/modal for review.

Additional evidence from the provided phone export:

- Source folder: `C:\Users\moham\Desktop\WhatsApp Chat with أغنى - الماليه`.
- Source text file: `WhatsApp Chat with أغنى - الماليه.txt`.
- Parsed source messages: `41,571`.
- Source date range: `2024-09-22 09:06` through `2026-06-04 10:12`.
- The export uses `M/D/YY` dates, not `D/M/YY`. Example: `5/31/26` must be May 31, 2026.
- The current importer misplaces slash-date exports because it defaults to day/month and only swaps when the guessed month is invalid.
- The source has `104` contact-card `.vcf` references. Existing import logic mishandles many filenames with spaces, because it matches only the final non-space token before `.vcf`.
- The source export contains no image/audio/document media files, only `Media omitted` placeholders and `.vcf` contact cards.

## Goals

1. Preserve chronological order in every monthly Markdown file on manual re-run, auto-watch, and imported history.
2. Provide a repair action for affected existing files by rebuilding or rewriting monthly files from the canonical WhatsApp message stream.
3. Add an in-app original chat viewer that shows the WhatsApp message stream before or after archiving.
4. Add a reliable auto-archive watcher for selected chats.
5. Support one-to-one chats, group chats, and other sensible WhatsApp chat categories without breaking existing group archive paths.

## Non-Goals

- Do not send messages or mark chats as read from the viewer.
- Do not require Obsidian to be installed.
- Do not silently delete user-edited Markdown. Any rewrite must create a backup first.
- Do not attempt to archive WhatsApp Status unless explicitly enabled later; it behaves differently from normal chats.

## Target Architecture

## Applied Skill Stack

Relevant local skills from `C:\Users\moham\.agent\skills\skills` were reviewed and applied to this plan:

- `app-builder`: Electron + React product structure and phased delivery.
- `ui-ux-pro-max`: professional UI rules, interaction quality, accessibility, visual polish, React/Tailwind guidance.
- `ui-ux-designer`: design-system thinking, user flows, inclusive UX, component governance.
- `frontend-design`: intentional aesthetic direction and production-grade frontend craft.
- `react-ui-patterns`: async loading/error/empty states, retry UX, modal/list patterns.
- `tailwind-design-system`: tokenized Tailwind styling, responsive patterns, component variants.
- `accessibility-compliance-accessibility-audit`: WCAG-focused keyboard, contrast, focus, screen-reader, and error-state audit.
- `ui-visual-validator`: screenshot-based visual verification before accepting UI changes.

No external skill installation is required because the relevant skills already exist locally. If a future run needs them available by name in a different agent context, install/register the above skill folders from the local skills directory rather than fetching remote replacements.

## Professional UI/UX Direction

### Product UX Thesis

This is not a marketing app. It is a desktop operations console for accountants, admins, and project staff who need to trust that WhatsApp evidence is archived correctly. The UI should feel calm, durable, searchable, and audit-friendly.

Design stance:

- **Aesthetic:** industrial utilitarian with refined dark-mode craft.
- **Tone:** serious, precise, bilingual, low-drama.
- **Differentiation anchor:** a three-pane archival cockpit where chat source, archive status, and vault output are visible as one workflow.
- **DFII estimate:** 12/15.
  - Aesthetic impact: 3
  - Context fit: 5
  - Implementation feasibility: 5
  - Performance safety: 4
  - Consistency risk: 5

Avoid:

- Landing-page composition.
- Oversized hero content inside the app.
- Decorative glass cards everywhere.
- Emoji as functional icons.
- Purple-heavy generic SaaS gradients.
- Hiding operational status behind vague success text.

### Design System

Create a lightweight design system in `src/index.css` and shared React helpers before adding new UI.

Tokens:

- Color:
  - `--surface-base`: app background.
  - `--surface-panel`: sidebars and main panels.
  - `--surface-raised`: modals, repeated chat rows, toolbar controls.
  - `--border-subtle`, `--border-strong`.
  - `--text-primary`, `--text-secondary`, `--text-muted`.
  - `--accent-sync`: archival action.
  - `--accent-watch`: watcher enabled/running.
  - `--accent-repair`: repair/destructive-adjacent action.
  - `--danger`, `--warning`, `--success`.
- Spacing:
  - 4px base grid.
  - 8px radius for repeated cards and controls.
  - 44px minimum touch/click target for toolbar buttons.
- Typography:
  - Keep system/Noto fallback for Arabic rendering reliability unless a local bundled font is added.
  - Use smaller, denser operational type: sidebar labels 12px, rows 14px, panel headings 16-20px.
  - Avoid hero-scale type except empty states.
- Motion:
  - 150-250ms color/opacity transitions.
  - Respect `prefers-reduced-motion`.
  - Avoid scale hover on dense list rows because it causes visual jitter.

Component primitives:

- `IconButton`: fixed 40-44px square, Lucide icon, tooltip, visible focus ring.
- `ToolbarButton`: icon + short label for major commands.
- `StatusPill`: connected, watcher running, archived, error, queued.
- `ProgressPanel`: archive/repair progress with determinate progress, latest event, retry details.
- `EmptyState`: contextual empty content for no vault, no chats, no search results.
- `ErrorBanner`: role alert, retry action, details disclosure.
- `ModalShell`: focus trap, Escape close, labelled title, scroll lock.
- `ChatRow`: fixed-height row with type icon, name, timestamp, unread count/status.
- `MessageBubble`: source chat viewer row with sender, timestamp, content, media placeholder, quote preview.

### Chat List UX

Replace the current group-only list with a professional chat browser:

- Header:
  - Search input.
  - Refresh icon button.
  - Filter segmented control: All, Groups, Contacts, Archived.
- Rows:
  - Use `Users`, `User`, `Archive`, or `MessageCircle` Lucide icons depending on chat type.
  - Show chat name, type label, latest activity date, unread count if available.
  - Use stable row height and no layout-shifting hover transforms.
- Empty states:
  - Loading chats: skeleton rows, not a centered spinner forever.
  - No matches: search-specific empty state.
  - WhatsApp disconnected: connection action state.

### Selected Chat Workspace UX

Turn the selected-chat panel into a command surface:

- Top summary strip:
  - Chat name, type, last activity, archive path preview.
  - Watcher status pill.
- Primary commands:
  - `Start Archive`
  - `Review Original Chat`
  - `Repair Archive Order`
  - `Import Phone Export`
  - `Open in Obsidian`
- Watcher control:
  - Toggle with explicit text: `Auto archive new messages`.
  - Show last watcher event and last error.
- Progress:
  - Archive, repair, and watcher jobs share the same progress component.
  - Button states must disable duplicate actions while a job is active.
  - Errors must be visible in-app, not only console logs.

### Original Chat Viewer UX

The viewer should feel like a read-only evidence browser:

- Opens from `Review Original Chat`.
- Modal or split panel with:
  - Sticky toolbar: search, date jump, refresh, close.
  - Virtualized or paginated message list for large chats.
  - Date separators.
  - Sender color/initial only as a secondary cue; never color-only identification.
  - Media placeholders with type and filename/metadata when available.
  - Quote previews shown compactly.
  - Loading older/newer messages affordance.
- Accessibility:
  - `role="dialog"` and `aria-labelledby`.
  - Focus starts at search or close button.
  - Escape closes.
  - Keyboard can scroll, search, refresh, and close.

### Repair UX

Repair is powerful and should be calm but explicit:

- Label: `Repair Archive Order`.
- Preflight confirmation:
  - Explains that files will be backed up first.
  - Shows target chat and vault path.
  - Shows expected behavior: rebuild/sort monthly Markdown files.
- Result summary:
  - Blocks processed.
  - Months rewritten.
  - Blocks moved across months.
  - Backup path.
  - Unparsed/unmatched messages.
- Never silently delete user-visible content without a backup.

### Watcher UX

Watcher status must be observable:

- Global status in sidebar:
  - Disconnected, Connected, Watcher off, Watcher on.
- Chat-level toggle in selected chat.
- Event feed:
  - queued
  - archived
  - skipped duplicate
  - failed with retry
- On app restart:
  - Show restored watcher settings after WhatsApp is ready.
  - If vault path is missing, watcher toggles stay disabled with a clear reason.

### Accessibility Requirements

Minimum standard: WCAG 2.2 AA where applicable.

- All buttons and icon-only controls need accessible names.
- All interactive controls need visible focus states.
- All async errors use `role="alert"` or `aria-live`.
- Keyboard navigation must reach:
  - vault selector
  - WhatsApp connect/logout
  - chat search/filter/list
  - selected chat commands
  - modal viewer controls
- Contrast:
  - Normal text at least 4.5:1.
  - Large text/icons at least 3:1.
  - Disabled states must still be understandable.
- RTL:
  - Current `LanguageContext` direction switching must apply to new modals, lists, filters, and toolbars.
  - Do not rely on physical left/right labels; use logical start/end layout.
- Motion:
  - Add a `prefers-reduced-motion` CSS block to suppress decorative transitions.

### Visual Validation Gates

After implementation, verify with Browser/Playwright screenshots:

- Desktop: 1440x900.
- Laptop: 1280x720.
- Tablet-ish: 768x1024.
- Narrow: 390x844.
- English and Arabic modes.
- States:
  - disconnected QR screen.
  - connected no vault.
  - chat list loaded.
  - selected group.
  - selected direct contact.
  - archive running.
  - repair confirmation.
  - chat viewer modal.
  - watcher enabled.
  - error banner.

Acceptance:

- No text overflow or clipped Arabic labels.
- No incoherent overlaps.
- No horizontal scroll at narrow widths.
- Focus ring visible on every command.
- Buttons do not resize while loading.
- Modal content scrolls internally and close button remains visible.

### Archive Engine

Create a reusable archive engine in `electron/archiver.js` instead of doing append-only writes inline.

Core helpers:

- `resolveArchivePaths(chat, vaultPath)`
  - Generates stable archive paths for groups and contacts.
  - Uses `chat.name`, contact display name, or phone number fallback.
  - Replaces `WhatsApp_Group` fallback with `WhatsApp_Chat`.
- `normalizeMessage(msg, client, contactCache)`
  - Converts a `whatsapp-web.js` message into a serializable record.
  - Includes `id`, `timestamp`, `monthKey`, `chatId`, `senderId`, `senderName`, `fromMe`, `type`, `body`, `hasMedia`, `mediaFilename`, `quotedPreview`, and rendering metadata.
- `renderMessageBlock(record)`
  - Produces the exact Obsidian block for one record.
  - Adds stable machine-readable comments:
    - `<!-- wa:id: ... -->`
    - `<!-- wa:timestamp: 1717480000 -->`
    - `<!-- wa:chat: ... -->`
- `writeMonthFile(chatsDir, monthKey, records)`
  - Sorts records by `timestamp`, then by stable message ID.
  - Rewrites the complete month file atomically via a temp file and rename.
- `mergeMonthRecords(existingManifestRecords, newRecords)`
  - Deduplicates by full serialized message ID, not only `msg.id.id`.
  - Keeps the newest record if an edit/revoke event updates a message.

State format:

```json
{
  "schemaVersion": 3,
  "chatId": "123@g.us",
  "chatName": "Example",
  "processedIds": ["..."],
  "messages": {
    "message-id": {
      "id": "message-id",
      "timestamp": 1717480000,
      "monthKey": "2026-06",
      "senderName": "Me",
      "type": "chat",
      "bodyHash": "..."
    }
  },
  "watch": {
    "enabled": true,
    "lastEventAt": 1717481111
  }
}
```

### Why This Fixes Ordering

The app should stop appending individual messages to monthly files. On every archive pass:

1. Fetch WhatsApp messages in chronological order.
2. Normalize only new or changed messages.
3. Merge them into the state manifest.
4. Re-render affected month files from sorted records.

This makes late-loaded older messages land in the correct month and correct position.

## Repair Plan for Affected Messages

Add a user-facing `Repair Archive Order` action for the selected chat.

Implementation:

- Add IPC: `whatsapp:repairArchive(chatId, vaultPath)`.
- Fetch the full available stream using `chat.fetchMessages({ limit: 999999 })`.
- Normalize all fetched messages.
- Back up existing files:
  - `Chats/2026-06.md` -> `Chats/.backup/2026-06.<timestamp>.md`
  - `archive_state.json` -> `archive_state.<timestamp>.json`
- Rebuild all affected month files from the fresh normalized records.
- Preserve existing media files if already downloaded.
- Download missing media only when the corresponding message still has downloadable media.
- Report:
  - months rewritten
  - messages rebuilt
  - messages previously in Markdown but not found in WhatsApp fetch
  - backup folder path

Important limitation:

- If WhatsApp Web can no longer fetch very old messages and they only exist in the Markdown file, the repair should not delete them. It should parse existing Markdown blocks using `wa:id` / legacy `<!-- id: ... -->` comments, retain unmatched legacy blocks at their parsed timestamp position when possible, and flag them in the repair report.

## Original Chat Viewer

Add an app-native viewer so the user can inspect the WhatsApp source stream without opening WhatsApp itself.

Main process:

- Add IPC: `whatsapp:getChatMessages(chatId, options)`.
- Options:
  - `limit`
  - `beforeTimestamp` or cursor-style pagination
  - `includeMediaPreview`
- Return serializable message DTOs only:
  - id
  - timestamp
  - sender display name
  - body
  - type
  - fromMe
  - hasMedia
  - media metadata, not full base64 by default
  - quoted preview

Renderer:

- Add a `Review Chat` button beside `Start Smart Archive`.
- Open a modal or secondary Electron window.
- Show:
  - chat title and type
  - chronological message list
  - sender, timestamp, type badge, text body
  - media placeholders
  - search box
  - jump-to-date control
  - refresh button
- Keep it read-only.

Recommended first version:

- Use an in-app modal/panel in `src/App.jsx`, because it avoids managing a second BrowserWindow lifecycle.
- Add a secondary BrowserWindow later only if the viewer needs independent sizing or multi-monitor use.

## Watcher Service

Add an explicit auto-archive service in `electron/main.js`, backed by persisted settings.

Main process state:

```js
const watchConfig = {
  vaultPath: null,
  enabledChatIds: new Set(),
  isRunning: false
};
```

IPC:

- `watcher:getStatus()`
- `watcher:setChatEnabled(chatId, vaultPath, enabled)`
- `watcher:setGlobalEnabled(enabled)`
- `watcher:archiveNow(chatId, vaultPath)`

WhatsApp event handlers:

- `message`: received messages.
- `message_create`: sent messages from the linked account.
- `message_edit`: update archived message body.
- `message_revoke_everyone`: mark archived message as deleted.
- `message_reaction`: optionally record reactions or skip with a status event.

Behavior:

- On incoming event, derive the chat ID:
  - For received messages: `msg.from`.
  - For outgoing messages: `msg.to`.
  - For group participant messages, still archive under `msg.from` because that is the group chat.
- If chat is enabled and vault path exists, enqueue a single-message archive job.
- Debounce per chat for 1-3 seconds to batch bursts.
- Use a per-chat queue/lock so manual archive and watcher cannot write the same files concurrently.
- Emit `watcher:event` updates to the renderer:
  - queued
  - archiving
  - archived
  - failed

Persist watcher settings:

- Use Electron `app.getPath('userData')`.
- File: `archiver-settings.json`.
- Store selected vault path, enabled chat IDs, global watcher enabled flag, and last status.

## Archive All Chat Types

Main process already returns all chats, but renderer filters groups only.

Changes:

- Remove `chatList.filter(c => c.isGroup)` from `src/App.jsx`.
- Return richer chat metadata from `electron/main.js`:
  - `isGroup`
  - `isReadOnly`
  - `archived`
  - `pinned`
  - `unreadCount`
  - `timestamp`
  - `typeLabel`
- Add UI filter tabs:
  - All
  - Groups
  - Contacts
  - Archived
- Use icons:
  - group icon for groups
  - user/message icon for contacts
  - archive icon for archived chats
- Update translations:
  - `chats`
  - `allChats`
  - `groups`
  - `contacts`
  - `reviewChat`
  - `autoArchive`
  - `repairArchive`

Path naming:

- Groups: `WhatsApp Archive/<group name>/...`
- Contacts: `WhatsApp Archive/<contact display name or phone>/...`
- Unknown: `WhatsApp Archive/WhatsApp_Chat_<shortId>/...`

## File-Level Work Plan

### Phase 1: Archive Core Refactor

Files:

- `electron/archiver.js`

Tasks:

- Extract path resolution, message normalization, rendering, state read/write, and month rewrite helpers.
- Replace `fs.appendFileSync(mdFilePath, content)` with sorted month rewrites.
- Upgrade `archive_state.json` to schema version 3.
- Keep compatibility with legacy `processedIds` state.
- Add atomic write helper.
- Add backups before any full rewrite.

Acceptance:

- A rerun with a new older message places it by timestamp in the correct month.
- Duplicate messages are not created.
- Existing state files continue to load.

### Phase 2: Repair Existing Archives

Files:

- `electron/archiver.js`
- `electron/main.js`
- `electron/preload.cjs`
- `src/App.jsx`
- `src/translations.js`

Tasks:

- Add `repairArchiveOrder(client, chatId, vaultPath, mainWindow)`.
- Add IPC/preload bridge.
- Add UI button and progress display.
- Generate a repair summary.

Acceptance:

- Repair creates backups before rewriting.
- Repair reports unmatched legacy blocks instead of silently dropping them.
- Repaired month files are sorted.

Completed one-off repair for the provided vault:

- Vault/chat: `E:\aghna chats\WhatsApp Archive\أغنى - الماليه`.
- Date-order backup: `E:\aghna chats\WhatsApp Archive\أغنى - الماليه\Chats\.backup-order-repair-2026-06-04T09-18-01-521Z`.
- Repaired `42,922` existing message blocks.
- Moved `15,355` blocks across month files after correcting import date interpretation to `M/D/YY`.
- Removed empty future/wrong month files after redistribution.
- Verified `0` remaining chronological inversions.

Completed one-off contact-card repair:

- Source export: `C:\Users\moham\Desktop\WhatsApp Chat with أغنى - الماليه`.
- First backup: `E:\aghna chats\WhatsApp Archive\أغنى - الماليه\Chats\.backup-vcf-repair-2026-06-04T09-25-15-575Z`.
- Second backup: `E:\aghna chats\WhatsApp Archive\أغنى - الماليه\Chats\.backup-vcf-repair-pass2-2026-06-04T09-27-34-012Z`.
- Added `104` `.vcf` links to imported message blocks.
- Copied `88` distinct `.vcf` files into `Documents`.
- Verified archive `.vcf` links: `104`.

### Phase 3: Original Chat Review UI

Files:

- `electron/main.js`
- `electron/preload.cjs`
- `src/App.jsx`
- `src/index.css`
- `src/translations.js`

Tasks:

- Add `whatsapp:getChatMessages`.
- Normalize messages for display without downloading full media by default.
- Add modal viewer with scroll, search, refresh, and date grouping.
- Add `Review Chat` button.

Acceptance:

- User can open the selected chat stream inside the app.
- Viewer handles group and one-to-one sender names correctly.
- Large chats do not freeze the UI; initial load is bounded with pagination.

### Phase 4: Watcher Service

Files:

- `electron/main.js`
- `electron/archiver.js`
- `electron/preload.cjs`
- `src/App.jsx`
- `src/translations.js`

Tasks:

- Register WhatsApp message lifecycle event handlers after client creation.
- Add per-chat queue and debounce.
- Persist watcher settings under Electron userData.
- Add chat-level toggle in the selected chat panel.
- Show watcher status and last error.

Acceptance:

- New received messages are archived automatically for enabled chats.
- Outgoing messages from the linked account are also archived.
- Manual archive and watcher jobs cannot corrupt files if triggered together.
- Watcher resumes after app restart once WhatsApp is ready.

### Phase 5: All Chat Types

Files:

- `electron/main.js`
- `src/App.jsx`
- `src/translations.js`

Tasks:

- Stop filtering to groups only.
- Add chat type labels and filters.
- Adjust empty/loading copy.
- Ensure archive folder fallback names are neutral, not group-only.

Acceptance:

- Groups and direct contacts both appear.
- Both can be archived and reviewed.
- Existing group archives keep their current folder names.

### Phase 5b: Phone Export Import Fidelity

Files:

- `electron/archiver.js`
- `src/App.jsx`
- `src/translations.js`

Tasks:

- Add import date-format detection:
  - Analyze slash-date samples before importing.
  - If dates like `5/31/26` exist, select `M/D/YY`.
  - If dates like `31/5/26` exist, select `D/M/YY`.
  - If all dates are ambiguous, ask the user before import.
- Persist chosen date format in import summary metadata.
- Parse `.vcf (file attached)` references using the full filename, including spaces and Arabic characters.
- Copy `.vcf` files into `Documents` and link them with `![[filename.vcf]]`.
- Preserve edited-message markers consistently as text, not formatting-sensitive noise.
- Preserve `Media omitted` as a clear placeholder without treating it as a missing local file.
- Add an import preview step:
  - message count
  - date range
  - detected date format
  - media omitted count
  - contact-card count
  - files found/missing

Acceptance:

- The provided source export imports as `41,571` messages.
- Date range is reported as `2024-09-22` to `2026-06-04`.
- No files after `2026-06.md` are created for this export.
- All `104` contact-card messages link to `.vcf` files.
- Import report clearly distinguishes omitted media from missing local files.

### Phase 6: Tests and Verification

Recommended tests:

- Add unit tests for pure archive helpers once extracted.
- Test `mergeMonthRecords`:
  - new future message
  - backfilled old message
  - duplicate ID
  - edited message body
  - same timestamp, different IDs
- Test legacy Markdown parser:
  - current `<!-- id: ... -->`
  - new `<!-- wa:id: ... -->`
  - malformed block
- Manual Electron verification:
  - connect WhatsApp
  - select group chat
  - review original stream
  - archive
  - rerun archive
  - repair archive
  - enable watcher
  - send/receive a message
  - archive direct contact chat

## Risk Notes

- `chat.fetchMessages({ limit: 999999 })` may be slow or may not retrieve all historical messages depending on WhatsApp Web cache/history availability. The viewer and repair should be paginated where possible.
- Existing Markdown files may include user edits. Backup-before-rewrite is mandatory.
- Message IDs should use `msg.id._serialized` when available, falling back to `msg.id.id`; `msg.id.id` alone can collide across chats.
- Media downloads may fail for old messages. The archive should keep message text and record media download failure without failing the whole job.
- Some chat categories such as channels/status may need explicit exclusion or a read-only warning because their message models can differ.

## Suggested Implementation Order

1. Refactor `electron/archiver.js` into deterministic sorted rendering.
2. Add repair action and backup flow.
3. Enable all chats in the list.
4. Add original chat viewer.
5. Add watcher service and persisted settings.
6. Add tests and run manual Electron verification.
