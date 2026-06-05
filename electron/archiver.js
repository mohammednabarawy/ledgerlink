import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ARCHIVE_SCHEMA_VERSION = 3;
const MAX_FETCH_LIMIT = 999999;

function sendProgress(mainWindow, status, progress, detail = {}) {
  if (mainWindow?.setProgressBar) {
    mainWindow.setProgressBar(progress > 0 && progress < 100 ? progress / 100 : -1);
  }
  mainWindow?.webContents?.send('archive:progress', { status, progress, ...detail });
}

function safeName(name, fallback = 'WhatsApp_Chat') {
  return (name || fallback)
    .replace(/[<>:"/\\|?*]/g, '_')
    .split('')
    .map(char => char.charCodeAt(0) < 32 ? '_' : char)
    .join('')
    .trim() || fallback;
}

function hashText(value) {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 16);
}

function normalizeSpace(value) {
  return String(value || '').replace(/\u202f|\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function atomicWrite(filePath, content) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, content, 'utf8');
  fs.renameSync(tempPath, filePath);
}

export function resolveArchivePaths(chatOrName, vaultPath, profileName = '', platform = 'whatsapp') {
  const accountFolder = profileName ? safeName(profileName) : '';
  const platformFolder = platform === 'telegram' ? 'Telegram Archive' : 'WhatsApp Archive';
  const archiveRoot = path.join(vaultPath, accountFolder, platformFolder);
  const displayName = typeof chatOrName === 'string' ? chatOrName : chatOrName?.name;
  const baseDir = path.join(archiveRoot, safeName(displayName));
  return {
    archiveRoot,
    baseDir,
    chatsDir: path.join(baseDir, 'Chats'),
    docsDir: path.join(baseDir, 'Documents'),
    mediaDir: path.join(baseDir, 'Media'),
    audioDir: path.join(baseDir, 'Audio'),
    avatarsDir: path.join(archiveRoot, '_Avatars'),
    stateFile: path.join(baseDir, 'archive_state.json'),
  };
}

function ensureArchiveDirs(paths) {
  [paths.archiveRoot, paths.baseDir, paths.chatsDir, paths.docsDir, paths.mediaDir, paths.audioDir, paths.avatarsDir]
    .forEach(ensureDir);
}

function cleanupLegacyArabicFolders(archiveRoot) {
  if (!fs.existsSync(archiveRoot)) return;
  for (const dir of fs.readdirSync(archiveRoot)) {
    if (!dir.includes('___________')) continue;
    try {
      fs.rmSync(path.join(archiveRoot, dir), { recursive: true, force: true });
    } catch (error) {
      console.warn('Could not cleanly delete legacy folder:', error);
    }
  }
}

function readState(stateFile) {
  if (!fs.existsSync(stateFile)) {
    return { schemaVersion: ARCHIVE_SCHEMA_VERSION, processedIds: [], messages: {}, imports: {} };
  }
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    return {
      schemaVersion: state.schemaVersion || (state.migrated_v2 ? 2 : 1),
      processedIds: state.processedIds || [],
      messages: state.messages || {},
      imports: state.imports || {},
      migrated_v2: state.migrated_v2,
      watch: state.watch || {},
    };
  } catch (error) {
    console.error('Failed to read archive state', error);
    return { schemaVersion: ARCHIVE_SCHEMA_VERSION, processedIds: [], messages: {}, imports: {} };
  }
}

function writeState(stateFile, state) {
  atomicWrite(stateFile, JSON.stringify({
    ...state,
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    migrated_v2: true,
  }, null, 2));
}

function monthKeyFromDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatLocalDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function parseTimeParts(timeRaw) {
  const time = normalizeSpace(timeRaw);
  const match = time.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const ampm = match[3]?.toUpperCase();
  if (ampm === 'PM' && hour !== 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  return { hour, minute };
}

function makeDate(year, month, day, timeRaw) {
  const time = parseTimeParts(timeRaw);
  if (!time) return null;
  const date = new Date(year, month - 1, day, time.hour, time.minute, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function parseSlashDate(dateRaw, timeRaw, order) {
  const parts = dateRaw.split(/[./-]/).map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  let year = parts[2];
  if (year < 100) year += 2000;
  const month = order === 'DMY' ? parts[1] : parts[0];
  const day = order === 'DMY' ? parts[0] : parts[1];
  return makeDate(year, month, day, timeRaw);
}

function parseDisplayStamp(stampRaw, fileMonthKey = null, preferredOrder = null) {
  const stamp = normalizeSpace(stampRaw);
  const iso = stamp.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (iso) {
    const date = makeDate(Number(iso[1]), Number(iso[2]), Number(iso[3]), `${iso[4]}:${iso[5]}`);
    return date ? { date, order: 'ISO' } : null;
  }

  const slash = stamp.match(/^(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\s+(.+)$/);
  if (!slash) return null;

  const candidates = ['MDY', 'DMY']
    .map(order => ({ order, date: parseSlashDate(slash[1], slash[2], order) }))
    .filter(candidate => candidate.date);

  if (!candidates.length) return null;
  if (preferredOrder) return candidates.find(candidate => candidate.order === preferredOrder) || candidates[0];
  if (fileMonthKey) {
    const matching = candidates.find(candidate => monthKeyFromDate(candidate.date) === fileMonthKey);
    if (matching) return matching;
  }
  return candidates[0];
}

function detectDateOrder(rawMessages) {
  let mdyValid = 0;
  let dmyValid = 0;
  let mdyOnly = 0;
  let dmyOnly = 0;

  for (const message of rawMessages) {
    const mdy = parseSlashDate(message.dateStr, message.timeStr, 'MDY');
    const dmy = parseSlashDate(message.dateStr, message.timeStr, 'DMY');
    if (mdy) mdyValid++;
    if (dmy) dmyValid++;
    if (mdy && !dmy) mdyOnly++;
    if (dmy && !mdy) dmyOnly++;
  }

  if (mdyOnly > 0 && dmyOnly === 0) return { order: 'MDY', ambiguous: false, mdyValid, dmyValid, mdyOnly, dmyOnly };
  if (dmyOnly > 0 && mdyOnly === 0) return { order: 'DMY', ambiguous: false, mdyValid, dmyValid, mdyOnly, dmyOnly };
  if (mdyValid > dmyValid) return { order: 'MDY', ambiguous: false, mdyValid, dmyValid, mdyOnly, dmyOnly };
  if (dmyValid > mdyValid) return { order: 'DMY', ambiguous: false, mdyValid, dmyValid, mdyOnly, dmyOnly };
  return { order: 'MDY', ambiguous: true, mdyValid, dmyValid, mdyOnly, dmyOnly };
}

function splitMarkdownBlocks(content) {
  return content
    .replace(/\r\n/g, '\n')
    .split(/\n---\n/g)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => `${part}\n\n---\n`);
}

function extractBlockMetadata(block, fileMonthKey) {
  const waTimestamp = block.match(/<!--\s*wa:timestamp:\s*(\d+)\s*-->/);
  const legacyId = block.match(/<!--\s*id:\s*([^>]+?)\s*-->/);
  const importedId = block.match(/<!--\s*imported id:\s*([^>]+?)\s*-->/);
  const header = block.match(/^> \[!note\].*? - \*([^*]+)\*/m);
  const parsed = header ? parseDisplayStamp(header[1], fileMonthKey) : null;
  const timestamp = waTimestamp ? Number(waTimestamp[1]) : parsed?.date?.getTime();
  const isImported = block.includes('#imported') || block.includes('<!-- imported');
  const sender = block.match(/^> \[!note\]\s+(?:!\[\[[^\]]+\]\]\s+)?\*\*(.*?)\*\*/m)?.[1] || '';
  const body = block
    .split(/\n> <div dir=/)[0]
    .replace(/^> \[!note\].*\n>\n?/m, '')
    .split('\n')
    .map(line => line.replace(/^> ?/, ''))
    .join('\n')
    .trim();
  const id = legacyId?.[1]?.trim()
    || importedId?.[1]?.trim()
    || (isImported ? `imported:${hashText(`${timestamp || fileMonthKey}|${sender}|${body}`)}` : `legacy:${hashText(block)}`);

  return {
    id,
    source: isImported ? 'imported' : 'live',
    timestamp: timestamp || Number.MAX_SAFE_INTEGER,
    monthKey: timestamp ? monthKeyFromDate(new Date(timestamp)) : fileMonthKey,
    sortKey: `${timestamp || Number.MAX_SAFE_INTEGER}:${id}`,
    block,
  };
}

function readExistingRecords(chatsDir) {
  if (!fs.existsSync(chatsDir)) return [];
  const records = [];
  for (const file of fs.readdirSync(chatsDir).filter(name => name.endsWith('.md'))) {
    const fileMonthKey = file.replace(/\.md$/, '');
    const filePath = path.join(chatsDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    for (const block of splitMarkdownBlocks(content)) {
      records.push(extractBlockMetadata(block, fileMonthKey));
    }
  }
  return records;
}

function writeRecordsToMonthFiles(chatsDir, records, changedIds = null) {
  ensureDir(chatsDir);
  const grouped = new Map();
  for (const record of records) {
    if (!grouped.has(record.monthKey)) grouped.set(record.monthKey, []);
    grouped.get(record.monthKey).push(record);
  }

  const existingMonths = fs.existsSync(chatsDir)
    ? fs.readdirSync(chatsDir).filter(name => name.endsWith('.md')).map(name => name.replace(/\.md$/, ''))
    : [];
  const allMonths = new Set([...existingMonths, ...grouped.keys()]);
  const touchedMonths = [];

  for (const monthKey of [...allMonths].sort()) {
    const recordsForMonth = (grouped.get(monthKey) || [])
      .sort((a, b) => (a.timestamp - b.timestamp) || a.id.localeCompare(b.id));
    const filePath = path.join(chatsDir, `${monthKey}.md`);
    const oldContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n') : '';
    const newContent = recordsForMonth.length
      ? `${recordsForMonth.map(record => record.block.trimEnd()).join('\n\n')}\n`
      : '';

    const monthHasChange = changedIds
      ? recordsForMonth.some(record => changedIds.has(record.id)) || (oldContent && !newContent)
      : oldContent !== newContent;

    if (!monthHasChange && oldContent === newContent) continue;
    if (!newContent) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } else {
      atomicWrite(filePath, newContent);
    }
    touchedMonths.push(monthKey);
  }

  return touchedMonths;
}

function mergeRecords(existingRecords, newRecords) {
  const map = new Map();
  for (const record of existingRecords) map.set(record.id, record);
  for (const record of newRecords) map.set(record.id, record);
  return [...map.values()];
}

async function getSenderInfo(client, msg, paths, contactCache) {
  const senderId = msg.fromMe
    ? (client.info?.wid?._serialized || 'me')
    : (msg.author || msg.from);
  if (contactCache.has(senderId)) return contactCache.get(senderId);

  let name;
  let avatarFile = null;
  try {
    const contact = await msg.getContact();
    name = msg.fromMe ? 'Me' : (contact.name || contact.pushname || contact.shortName || contact.number || senderId);
    if (typeof contact.getProfilePicUrl === 'function') {
      try {
        const picUrl = await contact.getProfilePicUrl();
        if (picUrl) {
          const response = await fetch(picUrl);
          const avatarPathId = String(senderId).replace(/[^a-zA-Z0-9]/g, '');
          avatarFile = `avatar_${avatarPathId}.jpg`;
          const avatarPath = path.join(paths.avatarsDir, avatarFile);
          if (!fs.existsSync(avatarPath)) {
            fs.writeFileSync(avatarPath, Buffer.from(await response.arrayBuffer()));
          }
        }
      } catch {
        // Profile pictures can be blocked by privacy settings.
      }
    }
  } catch {
    // Use fallback below.
  }
  name ||= msg.fromMe ? 'Me' : senderId;

  const info = { id: senderId, name, avatarFile };
  contactCache.set(senderId, info);
  return info;
}

function mediaTargetDir(mimetype, paths, msgType = null) {
  if (msgType === 'ptt' || msgType === 'audio') return paths.audioDir;
  if (mimetype?.startsWith('audio/') || mimetype === 'application/ogg') return paths.audioDir;
  if (mimetype?.startsWith('image/') || mimetype?.startsWith('video/')) return paths.mediaDir;
  return paths.docsDir;
}

function mediaEmbedPath(filePath, chatsDir) {
  const relative = path.relative(chatsDir, filePath).replace(/\\/g, '/');
  return relative.startsWith('..') ? relative : path.basename(filePath);
}

async function renderLiveRecord(client, msg, paths, contactCache, existingOcr = null) {
  const messageId = msg.id?._serialized || msg.id?.id;
  const shortId = msg.id?.id || messageId;
  const date = new Date(msg.timestamp * 1000);
  const sender = await getSenderInfo(client, msg, paths, contactCache);
  let mediaState = null;
  const avatarString = sender.avatarFile ? `![[${sender.avatarFile}|24]] ` : '';
  let block = `> [!note] ${avatarString}**${sender.name}** - *${formatLocalDate(date)}*\n>\n`;

  if (msg.hasQuotedMsg) {
    try {
      const quotedMsg = await msg.getQuotedMessage();
      const quotedPreview = quotedMsg?.body ? quotedMsg.body.substring(0, 80).replace(/\n/g, ' ') : '[Media/Attachment]';
      block += `> > [!quote] Replying to message\n> > ${quotedPreview}\n>\n`;
    } catch {
      block += `> > [!quote] Replying to an older message\n>\n`;
    }
  }

  const typeLabels = {
    location: '[Location Shared]',
    vcard: '[Contact Card Shared]',
    multi_vcard: '[Contact Card Shared]',
    poll_creation: '[Poll Created]',
    sticker: '[Sticker]',
    reaction: '[Reacted to a message]',
    revoked: '[This message was deleted]',
  };
  if (typeLabels[msg.type]) block += `> *${typeLabels[msg.type]}*\n>\n`;

  if (msg.hasMedia && msg.type !== 'sticker') {
    try {
      const media = await msg.downloadMedia();
      if (media) {
        const ext = media.filename?.split('.').pop()
          || media.mimetype?.split('/')[1]?.split(';')[0]
          || 'bin';
        const filename = media.filename || `${shortId}.${ext}`;
        const targetDir = mediaTargetDir(media.mimetype, paths, msg.type);
        ensureDir(targetDir);
        const filePath = path.join(targetDir, filename);
        if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));
        const embedPath = mediaEmbedPath(filePath, paths.chatsDir);
        block += `> ![[${embedPath}]]\n>\n`;
        mediaState = {
          filename,
          mimetype: media.mimetype || null,
          relativePath: path.relative(paths.baseDir, filePath).replace(/\\/g, '/'),
          folder: path.basename(targetDir),
        };
      }
    } catch (error) {
      block += `> *[Error downloading media: ${error.message}]*\n>\n`;
    }
  }

  if (existingOcr) {
    block += `> [!receipt] **OCR Extracted** — Confidence: ${existingOcr.confidence}%\n`;
    if (existingOcr.imageFile) {
      block += `> **Source attachment:** ![[${existingOcr.imageFile.replace(/\\/g, '/')}]]\n`;
    }
    if (existingOcr.vendor) block += `> **Vendor:** ${existingOcr.vendor}\n`;
    if (existingOcr.date) block += `> **Date:** ${existingOcr.date}\n`;
    if (existingOcr.total) block += `> **Total:** ${existingOcr.currency || 'SAR'} ${existingOcr.total}\n`;
    if (existingOcr.tax) block += `> **VAT/Tax:** ${existingOcr.currency || 'SAR'} ${existingOcr.tax}\n`;
    block += `>\n`;
    block += `> <details><summary>Full OCR Text</summary>\n>\n`;
    block += `${existingOcr.text.split('\n').map(line => `> ${line}`).join('\n')}\n`;
    block += `> \n> </details>\n>\n`;
  }

  if (msg.body && msg.type !== 'poll_creation' && msg.type !== 'reaction') {
    block += `${msg.body.split('\n').map(line => `> ${line}`).join('\n')}\n>\n`;
  }

  const safeTag = safeName(sender.name, 'Unknown').replace(/\s/g, '_');
  const timestamp = date.getTime();
  let tags = `Tags: #sender/${safeTag}`;
  if (existingOcr) {
    tags += ` #receipt #ocr`;
    if (existingOcr.vendor) tags += ` #vendor/${safeName(existingOcr.vendor).replace(/\s/g, '_')}`;
    if (existingOcr.total) {
      const parsedTotal = parseFloat(existingOcr.total.replace(/,/g, ''));
      if (!isNaN(parsedTotal)) tags += ` #amount/${Math.round(parsedTotal)}`;
    }
  }
  block += `> \n> <div dir="auto" style="margin-top: 8px; font-size: 0.85em; color: var(--text-muted);">${tags}</div>\n`;
  block += `<!-- id: ${shortId} -->\n<!-- wa:id: ${messageId} -->\n<!-- wa:timestamp: ${timestamp} -->\n\n---\n`;

  return {
    id: messageId,
    legacyId: shortId,
    source: 'live',
    timestamp,
    monthKey: monthKeyFromDate(date),
    sortKey: `${timestamp}:${messageId}`,
    block,
    state: {
      id: messageId,
      legacyId: shortId,
      timestamp,
      monthKey: monthKeyFromDate(date),
        senderName: sender.name,
        type: msg.type,
        bodyHash: hashText(msg.body || ''),
        hasMedia: !!msg.hasMedia,
        media: mediaState,
      },
  };
}

function parseExportMessages(txtFilePath) {
  const lines = fs.readFileSync(txtFilePath, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const dateRegex = /^\[?(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)\]?\s*(?:-)?\s*(.*?):\s*(.*)$/i;
  const messages = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(dateRegex);
    if (match) {
      if (current) messages.push(current);
      current = {
        dateStr: match[1],
        timeStr: normalizeSpace(match[2]),
        sender: match[3],
        body: match[4],
      };
    } else if (current) {
      current.body += `\n${line}`;
    }
  }
  if (current) messages.push(current);
  return messages;
}

function findAttachment(body) {
  const trimmed = body.trim();
  const attached = trimmed.match(/<attached:\s*([^>]+)>/i);
  if (attached) return attached[1].trim();
  const fileAttached = trimmed.match(/(.+\.(?:jpg|jpeg|png|mp4|pdf|opus|mp3|m4a|ogg|wav|doc|docx|xls|xlsx|vcf))\s*\(file attached\)$/i);
  if (fileAttached) return fileAttached[1].trim();
  return null;
}

function targetDirForFilename(filename, paths) {
  if (filename.match(/\.(jpg|jpeg|png|mp4)$/i)) return paths.mediaDir;
  if (filename.match(/\.(opus|mp3|m4a|ogg|wav)$/i)) return paths.audioDir;
  return paths.docsDir;
}

function renderImportedRecord(rawMessage, date, dateOrder, txtFilePath, paths) {
  const filename = findAttachment(rawMessage.body);
  let block = `> [!note] **${rawMessage.sender}** - *${rawMessage.dateStr} ${rawMessage.timeStr}*\n>\n`;
  let cleanBody = rawMessage.body;
  let attachmentFound = false;
  let mediaOmitted = /<?Media omitted>?/i.test(rawMessage.body);

  if (filename) {
    const sourcePath = path.join(path.dirname(txtFilePath), filename);
    const targetDir = targetDirForFilename(filename, paths);
    ensureDir(targetDir);
    if (fs.existsSync(sourcePath)) {
      const destPath = path.join(targetDir, filename);
      if (!fs.existsSync(destPath)) fs.copyFileSync(sourcePath, destPath);
      block += `> ![[${filename}]]\n`;
      block += `> ${filename.replace(/\.[^.]+$/, '')}\n>\n`;
      attachmentFound = true;
    } else {
      block += `> *[Attachment not found: ${filename}]*\n>\n`;
    }
    cleanBody = cleanBody
      .replace(/<attached:\s*[^>]+>/i, '')
      .replace(new RegExp(`${filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(file attached\\)`, 'i'), '')
      .trim();
  }

  if (cleanBody) {
    block += `${cleanBody.split('\n').map(line => `> ${line}`).join('\n')}\n>\n`;
  }

  const timestamp = date.getTime();
  const id = `imported:${hashText(`${timestamp}|${rawMessage.sender}|${rawMessage.body}`)}`;
  const safeTag = safeName(rawMessage.sender, 'Unknown').replace(/\s/g, '_');
  block += `> \n> <div dir="auto" style="margin-top: 8px; font-size: 0.85em; color: var(--text-muted);">Tags: #sender/${safeTag} #imported</div>\n`;
  block += `<!-- imported -->\n<!-- imported id: ${id} -->\n<!-- wa:timestamp: ${timestamp} -->\n<!-- wa:date-order: ${dateOrder} -->\n\n---\n`;

  return {
    id,
    source: 'imported',
    timestamp,
    monthKey: monthKeyFromDate(date),
    sortKey: `${timestamp}:${id}`,
    block,
    stats: { attachmentFound, mediaOmitted, hasAttachment: !!filename },
  };
}

export async function archiveChat(client, chatId, vaultPath, mainWindow, options = {}) {
  try {
    const chat = options.chat || (options.platform === 'telegram'
      ? { name: options.chatName || 'Telegram_Chat' }
      : await client.getChatById(chatId));
    const paths = resolveArchivePaths(chat, vaultPath, options.profileName, options.platform || 'whatsapp');
    cleanupLegacyArabicFolders(paths.archiveRoot);
    ensureArchiveDirs(paths);

    sendProgress(mainWindow, 'Fetching messages...', 0);
    let messages;
    if (options.messages) {
      messages = options.messages;
    } else if (options.singleMessage) {
      messages = [options.singleMessage];
    } else {
      messages = await chat.fetchMessages({ limit: MAX_FETCH_LIMIT });
    }
    const existingRecords = readExistingRecords(paths.chatsDir);
    const existingLiveIds = new Set(existingRecords.filter(record => record.source === 'live').map(record => record.id));
    const contactCache = new Map();
    const newRecords = [];
    const changedIds = new Set();
    const state = readState(paths.stateFile);
    let processed = 0;
    let newMessagesAdded = 0;

    for (const msg of messages) {
      processed++;
      if (processed % 10 === 0) {
        sendProgress(mainWindow, `Processing message ${processed} of ${messages.length}`, (processed / messages.length) * 90);
      }
      const msgId = msg.id?._serialized || msg.id?.id;
      const existingOcr = state.messages[msgId]?.ocr || null;
      
      const record = await renderLiveRecord(client, msg, paths, contactCache, existingOcr);
      newRecords.push(record);
      state.messages[record.id] = {
        ...record.state,
        ocr: existingOcr
      };
      if (!existingLiveIds.has(record.id)) newMessagesAdded++;
      changedIds.add(record.id);
    }

    const merged = mergeRecords(
      existingRecords.filter(record => !newRecords.some(newRecord => newRecord.id === record.id)),
      newRecords,
    );
    const touchedMonths = writeRecordsToMonthFiles(paths.chatsDir, merged, changedIds);

    const processedIds = new Set([...(state.processedIds || [])]);
    for (const record of newRecords) {
      processedIds.add(record.id);
      if (record.legacyId) processedIds.add(record.legacyId);
    }
    state.processedIds = [...processedIds];
    writeState(paths.stateFile, state);

    sendProgress(mainWindow, `Archive complete. Added ${newMessagesAdded} new messages.`, 100);
    return { success: true, count: messages.length, newMessagesAdded, touchedMonths };
  } catch (error) {
    console.error('Archive failed', error);
    mainWindow?.webContents?.send('archive:error', error.message);
    throw error;
  }
}

export async function repairArchiveOrder(client, chatId, vaultPath, mainWindow, options = {}) {
  try {
    const chat = await client.getChatById(chatId);
    const paths = resolveArchivePaths(chat, vaultPath, options.profileName, options.platform || 'whatsapp');
    ensureArchiveDirs(paths);
    const backupDir = path.join(paths.chatsDir, `.backup-repair-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    ensureDir(backupDir);
    for (const file of fs.readdirSync(paths.chatsDir).filter(name => name.endsWith('.md'))) {
      fs.copyFileSync(path.join(paths.chatsDir, file), path.join(backupDir, file));
    }
    if (fs.existsSync(paths.stateFile)) fs.copyFileSync(paths.stateFile, path.join(backupDir, 'archive_state.json'));
    const result = await archiveChat(client, chatId, vaultPath, mainWindow, options);
    return { ...result, backupDir };
  } catch (error) {
    console.error('Repair failed', error);
    mainWindow?.webContents?.send('archive:error', error.message);
    throw error;
  }
}

export async function importHistory(chatName, vaultPath, txtFilePath, mainWindow, options = {}) {
  try {
    sendProgress(mainWindow, 'Parsing exported file...', 0);
    const paths = resolveArchivePaths(chatName, vaultPath, options.profileName, options.platform || 'whatsapp');
    ensureArchiveDirs(paths);

    const rawMessages = parseExportMessages(txtFilePath);
    const detection = options.dateOrder
      ? { order: options.dateOrder, ambiguous: false }
      : detectDateOrder(rawMessages);
    const dateOrder = detection.order;

    const existingRecords = readExistingRecords(paths.chatsDir);
    const existingIds = new Set(existingRecords.map(record => record.id));
    const importRecords = [];
    let mediaOmitted = 0;
    let attachmentsFound = 0;
    let attachmentsMissing = 0;

    rawMessages.forEach((message, index) => {
      if (index % 250 === 0) {
        sendProgress(mainWindow, `Importing message ${index + 1} of ${rawMessages.length}`, (index / rawMessages.length) * 90);
      }
      const date = parseSlashDate(message.dateStr, message.timeStr, dateOrder);
      if (!date) return;
      const record = renderImportedRecord(message, date, dateOrder, txtFilePath, paths);
      if (record.stats.mediaOmitted) mediaOmitted++;
      if (record.stats.hasAttachment && record.stats.attachmentFound) attachmentsFound++;
      if (record.stats.hasAttachment && !record.stats.attachmentFound) attachmentsMissing++;
      if (!existingIds.has(record.id)) importRecords.push(record);
    });

    const changedIds = new Set(importRecords.map(record => record.id));
    const merged = mergeRecords(existingRecords, importRecords);
    const touchedMonths = writeRecordsToMonthFiles(paths.chatsDir, merged, changedIds);

    const state = readState(paths.stateFile);
    state.imports[hashText(txtFilePath)] = {
      txtFilePath,
      importedAt: new Date().toISOString(),
      count: rawMessages.length,
      added: importRecords.length,
      dateOrder,
      dateDetection: detection,
      mediaOmitted,
      attachmentsFound,
      attachmentsMissing,
    };
    writeState(paths.stateFile, state);

    const status = detection.ambiguous
      ? `Import complete. Added ${importRecords.length}. Date order was ambiguous; used ${dateOrder}.`
      : `Import complete. Added ${importRecords.length} messages.`;
    sendProgress(mainWindow, status, 100);
    return {
      success: true,
      count: rawMessages.length,
      added: importRecords.length,
      dateOrder,
      dateDetection: detection,
      mediaOmitted,
      attachmentsFound,
      attachmentsMissing,
      touchedMonths,
    };
  } catch (error) {
    console.error('Import failed', error);
    mainWindow?.webContents?.send('archive:error', error.message);
    throw error;
  }
}

export async function getChatMessages(client, chatId, options = {}) {
  const chat = await client.getChatById(chatId);
  const limit = Math.min(Number(options.limit) || 200, 1000);
  const messages = await chat.fetchMessages({ limit });
  const contactCache = new Map();

  let state = { messages: {} };
  if (options.vaultPath) {
    try {
      const paths = resolveArchivePaths(chat, options.vaultPath, options.profileName, 'whatsapp');
      if (fs.existsSync(paths.stateFile)) {
        state = JSON.parse(fs.readFileSync(paths.stateFile, 'utf8'));
      }
    } catch {
      // ignore
    }
  }

  return Promise.all(messages.map(async msg => {
    let senderName = msg.fromMe ? 'Me' : (msg.author || msg.from);
    try {
      const contact = await msg.getContact();
      senderName = msg.fromMe ? 'Me' : (contact.name || contact.pushname || contact.shortName || contact.number || senderName);
    } catch {
      // Use fallback above.
    }
    const date = new Date(msg.timestamp * 1000);
    const id = msg.id?._serialized || msg.id?.id;
    if (!contactCache.has(senderName)) contactCache.set(senderName, true);
    
    const ocr = state.messages?.[id]?.ocr || null;

    return {
      id,
      timestamp: date.getTime(),
      displayTime: formatLocalDate(date),
      senderName,
      fromMe: msg.fromMe,
      type: msg.type,
      body: msg.body || '',
      hasMedia: msg.hasMedia,
      hasQuotedMsg: msg.hasQuotedMsg,
      ocr,
    };
  }));
}
