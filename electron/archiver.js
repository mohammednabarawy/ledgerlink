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

function getRecordAliases(record) {
  const aliases = new Set([record.id]);
  if (record.legacyId) aliases.add(record.legacyId);
  const waMatch = record.block?.match(/<!--\s*wa:id:\s*([^>]+?)\s*-->/);
  const shortMatch = record.block?.match(/<!--\s*id:\s*([^>]+?)\s*-->/);
  if (waMatch?.[1]) aliases.add(waMatch[1].trim());
  if (shortMatch?.[1]) aliases.add(shortMatch[1].trim());
  return aliases;
}

function recordsOverlap(a, b) {
  const aAliases = getRecordAliases(a);
  return [...getRecordAliases(b)].some(alias => aAliases.has(alias));
}

const NOTE_LINE = (line = '') => `>${line ? ` ${line}` : ''}`;
const NESTED_LINE = (line = '') => `> >${line ? ` ${line}` : ''}`;
const OCR_LEGACY_RE = /(?:^|\n)(?:> >|>)\s*\[!receipt\][\s\S]*?(?:> >|>)\s*<\/details>\n?(?:> >|>)\n?/g;
const OCR_BLOCK_RE = /(?:^|\n)> \*\*OCR Extracted\*\*[\s\S]*?(?=\n> \n> \*Tags:|\n<!--|\n---\n|$)/g;
const TRANSCRIPT_LEGACY_RE = /(?:^|\n)(?:> >|>)\s*\[!transcript\][\s\S]*?(?=\n> \n> \*Tags:|\n> \n> <div dir=|\n<!--|\n---\n|$)/g;
const TRANSCRIPT_BLOCK_RE = /(?:^|\n)> \*\*Transcription\*\*[\s\S]*?(?=\n> \n> \*Tags:|\n<!--|\n---\n|$)/g;

function formatTagsFooter(tags) {
  return `> \n> *Tags: ${tags}*\n`;
}

function extractTagsFromBlock(block) {
  const divMatch = block.match(/> \n> <div dir="auto"[^>]*>Tags:\s*([^<]+)<\/div>/);
  if (divMatch) return formatTagsFooter(divMatch[1].trim());
  const mdMatch = block.match(/> \n> \*Tags:\s*([^*]+)\*/);
  if (mdMatch) return formatTagsFooter(mdMatch[1].trim());
  return formatTagsFooter('#sender/Unknown');
}

function stripMediaEnrichmentBlocks(middle) {
  return middle
    .replace(OCR_LEGACY_RE, '\n')
    .replace(OCR_BLOCK_RE, '\n')
    .replace(TRANSCRIPT_LEGACY_RE, '\n')
    .replace(TRANSCRIPT_BLOCK_RE, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

function normalizeBlockStyle(block) {
  return block
    .replace(/> \[!receipt\] \*\*OCR Extracted\*\* —/g, '> [!receipt] **OCR Extracted** -')
    .replace(/> \[!transcript\] \*\*Transcription\*\* —/g, '> [!transcript] **Transcription** -')
    .replace(/> \[!transcript\] \*\*Voice transcript\*\*/g, '> [!transcript] **Transcription**');
}

function attachmentWikiPath(relativePath, chatsDir) {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  if (!normalized) return normalized;
  if (normalized.startsWith('../')) return normalized;
  const archiveRoot = path.dirname(chatsDir);
  const absolute = path.join(archiveRoot, normalized);
  if (fs.existsSync(absolute)) return mediaEmbedPath(absolute, chatsDir);
  if (/^(Media|Audio|Documents)\//.test(normalized)) return `../${normalized}`;
  return normalized;
}

function findStateEntry(state, record) {
  const aliases = getRecordAliases(record);
  for (const [id, entry] of Object.entries(state?.messages || {})) {
    const entryAliases = new Set([id, entry?.id, entry?.legacyId].filter(Boolean));
    if ([...aliases].some((alias) => entryAliases.has(alias))) return entry;
  }
  return null;
}

function shouldSkipRedundantBody(body, mediaState) {
  if (!body?.trim() || !mediaState?.filename) return false;
  const trimmed = body.trim();
  const filename = mediaState.filename;
  if (trimmed === filename || trimmed === path.basename(filename)) return true;
  if (/<attached:\s*[^>]+>/i.test(trimmed)) return true;
  if (new RegExp(`${filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(file attached\\)`, 'i').test(trimmed)) return true;
  return false;
}

function normalizeWikiPathInBlock(wikiPath, paths) {
  if (wikiPath.startsWith('../')) return wikiPath;
  const normalized = wikiPath.replace(/\\/g, '/');
  const archiveRoot = paths.baseDir;
  const direct = path.join(archiveRoot, normalized);
  if (fs.existsSync(direct)) return mediaEmbedPath(direct, paths.chatsDir);
  const basename = path.basename(normalized);
  for (const folder of ['Media', 'Audio', 'Documents']) {
    const candidate = path.join(archiveRoot, folder, basename);
    if (fs.existsSync(candidate)) return mediaEmbedPath(candidate, paths.chatsDir);
  }
  if (/^(Media|Audio|Documents)\//.test(normalized)) return `../${normalized}`;
  return wikiPath;
}

function fixMiddleEmbedPaths(middle, paths) {
  return middle.replace(/^[> ]*!\[\[([^\]|]+)(\|[^\]]+)?\]\]/gm, (_full, wikiPath, sizeSuffix = '') => {
    const fixed = normalizeWikiPathInBlock(wikiPath, paths);
    return `> ![[${fixed}${sizeSuffix || ''}]]`;
  });
}

function stripRedundantFilenameLine(middle) {
  const lines = middle.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const embedMatch = line.match(/^> !\[\[(?:\.\.\/)?(?:Media|Audio|Documents)\/([^\]|]+)/);
    if (embedMatch && i + 2 < lines.length && lines[i + 1] === '>' && lines[i + 2]?.startsWith('> ')) {
      const filename = embedMatch[1];
      const bodyText = lines[i + 2].slice(2).trim();
      if (bodyText === filename || bodyText === decodeURIComponent(filename)) {
        out.push(line, lines[i + 1]);
        i += 2;
        if (i + 1 < lines.length && lines[i + 1] === '>') i += 1;
        continue;
      }
    }
    out.push(line);
  }
  return out.join('\n');
}

function normalizeQuoteLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return '>';
  if (trimmed.startsWith('<!--')) return trimmed;
  if (/^> >(\s|$)/.test(trimmed)) return trimmed;
  const content = trimmed.replace(/^>+\s*/, '');
  if (!content) return '>';
  return `> ${content}`;
}

function ensureBlockquotePrefix(middle) {
  return middle.split('\n').map((line) => normalizeQuoteLine(line)).join('\n');
}

function insertMediaCallouts(middle, ocrBlock, transcriptBlock) {
  const callouts = `${ocrBlock}${transcriptBlock}`;
  if (!callouts) return middle;
  const embedIdx = middle.search(/^> ?!\[\[[^\]]+\]\]/m);
  if (embedIdx === -1) return `${middle}${middle.endsWith('\n') ? '' : '\n'}${callouts}`;
  const afterEmbed = middle.slice(embedIdx);
  const embedBlockMatch = afterEmbed.match(/^> ?!\[\[[^\]]+\]\]\n(?:>\n)?/);
  let insertAt = embedIdx + (embedBlockMatch?.[0]?.length || 0);
  let prefix = middle.slice(0, insertAt);
  if (!prefix.endsWith('>\n')) prefix += '>\n';
  return `${prefix}${callouts}${middle.slice(insertAt)}`;
}

function rebuildRecordBlock(record, stateEntry, paths) {
  let block = normalizeBlockStyle(record.block);
  const headerMatch = block.match(/^> \[!note\][^\n]*\n>\n/);
  if (!headerMatch) return block;

  const header = headerMatch[0];
  const tags = extractTagsFromBlock(block);
  const commentsMatch = block.match(/\n(<!--[\s\S]*?)\n\n---\n$/);
  const comments = commentsMatch?.[1] || '';

  let middle = block.slice(header.length);
  const tagsIndex = middle.search(/\n> \n> (?:<div dir="auto"|\*Tags:)/);
  if (tagsIndex !== -1) middle = middle.slice(0, tagsIndex);
  middle = stripMediaEnrichmentBlocks(middle);
  middle = fixMiddleEmbedPaths(middle, paths);
  middle = stripRedundantFilenameLine(middle);
  middle = ensureBlockquotePrefix(middle);

  const ocrBlock = stateEntry?.ocr ? formatOcrCalloutBlock(stateEntry.ocr, paths.chatsDir) : '';
  const transcriptBlock = stateEntry?.transcription?.text
    ? formatTranscriptionCalloutBlock(stateEntry.transcription, paths.chatsDir)
    : '';
  middle = insertMediaCallouts(middle, ocrBlock, transcriptBlock);
  middle = ensureBlockquotePrefix(middle);

  if (middle && !middle.endsWith('\n')) middle += '\n';
  return `${header}${middle}${tags}\n${comments}\n\n---\n`;
}

export function normalizeArchiveStyles(paths, mainWindow = null) {
  const state = readState(paths.stateFile);
  const records = readExistingRecords(paths.chatsDir);
  const changedIds = new Set();
  const normalized = records.map((record) => {
    const stateEntry = findStateEntry(state, record);
    const rebuilt = rebuildRecordBlock(record, stateEntry, paths);
    if (rebuilt !== record.block) {
      changedIds.add(record.id);
      return { ...record, block: rebuilt };
    }
    return record;
  });

  const touchedMonths = changedIds.size
    ? writeRecordsToMonthFiles(paths.chatsDir, normalized, changedIds)
    : [];

  sendProgress(mainWindow, `Style normalization complete (${changedIds.size} messages updated).`, 100);
  return { success: true, updated: changedIds.size, touchedMonths };
}

function dedupeExistingRecords(records) {
  const kept = [];
  for (const record of records) {
    const normalized = { ...record, block: normalizeBlockStyle(record.block) };
    const overlapIndex = kept.findIndex((entry) => recordsOverlap(entry, normalized));
    if (overlapIndex === -1) {
      kept.push(normalized);
      continue;
    }
    const existing = kept[overlapIndex];
    const preferNew = (
      (normalized.source === 'live' && existing.source !== 'live')
      || (normalized.block.includes('<!-- wa:id:') && !existing.block.includes('<!-- wa:id:'))
      || normalized.block.length > existing.block.length
    );
    kept[overlapIndex] = preferNew ? normalized : existing;
  }
  return kept;
}

function extractBlockMetadata(block, fileMonthKey) {
  const waTimestamp = block.match(/<!--\s*wa:timestamp:\s*(\d+)\s*-->/);
  const waId = block.match(/<!--\s*wa:id:\s*([^>]+?)\s*-->/);
  const legacyShortId = block.match(/<!--\s*id:\s*([^>]+?)\s*-->/);
  const importedId = block.match(/<!--\s*imported id:\s*([^>]+?)\s*-->/);
  const header = block.match(/^> \[!note\].*? - \*([^*]+)\*/m);
  const parsed = header ? parseDisplayStamp(header[1], fileMonthKey) : null;
  const timestamp = waTimestamp ? Number(waTimestamp[1]) : parsed?.date?.getTime();
  const isImported = block.includes('#imported') || block.includes('<!-- imported');
  const sender = block.match(/^> \[!note\]\s+(?:!\[\[[^\]]+\]\]\s+)?\*\*(.*?)\*\*/m)?.[1] || '';
  const body = block
    .split(/\n> \n> (?:<div dir=|\*Tags:)/)[0]
    .replace(/^> \[!note\].*\n>\n?/m, '')
    .split('\n')
    .map(line => line.replace(/^> ?/, ''))
    .join('\n')
    .trim();
  const id = waId?.[1]?.trim()
    || legacyShortId?.[1]?.trim()
    || importedId?.[1]?.trim()
    || (isImported ? `imported:${hashText(`${timestamp || fileMonthKey}|${sender}|${body}`)}` : `legacy:${hashText(block)}`);

  return {
    id,
    legacyId: legacyShortId?.[1]?.trim() || null,
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
  return dedupeExistingRecords(records);
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

  for (const record of newRecords) {
    for (const [existingId, existing] of [...map.entries()]) {
      if (recordsOverlap(existing, record)) map.delete(existingId);
    }
    map.set(record.id, record);
  }

  return [...map.values()];
}

export function formatOcrCalloutBlock(ocrData, chatsDir = null) {
  const confidence = Math.round(Number(ocrData.confidence) || 0);
  const lines = [
    NOTE_LINE(`**OCR Extracted** — Confidence: ${confidence}%`),
  ];
  if (ocrData.imageFile) {
    const imagePath = chatsDir
      ? attachmentWikiPath(ocrData.imageFile, chatsDir)
      : ocrData.imageFile.replace(/\\/g, '/');
    lines.push(NOTE_LINE(`**Source:** ![[${imagePath}]]`));
  }
  if (ocrData.vendor) lines.push(NOTE_LINE(`**Vendor:** ${ocrData.vendor}`));
  if (ocrData.date) lines.push(NOTE_LINE(`**Date:** ${ocrData.date}`));
  if (ocrData.total) lines.push(NOTE_LINE(`**Total:** ${ocrData.currency || 'SAR'} ${ocrData.total}`));
  if (ocrData.tax) lines.push(NOTE_LINE(`**VAT/Tax:** ${ocrData.currency || 'SAR'} ${ocrData.tax}`));
  const ocrText = String(ocrData.text || '').trim();
  if (ocrText) {
    lines.push(NOTE_LINE());
    lines.push(NESTED_LINE('[!abstract]- Full OCR Text'));
    for (const line of ocrText.split('\n')) {
      lines.push(NESTED_LINE(line));
    }
  }
  lines.push(NOTE_LINE());
  return `${lines.join('\n')}\n`;
}

export function formatTranscriptionCalloutBlock(transcriptionData, chatsDir = null) {
  const confidence = Math.round(Number(transcriptionData.confidence) || 0);
  const lines = [
    NOTE_LINE(`**Transcription** — Confidence: ${confidence}%`),
  ];
  if (transcriptionData.sourceFile) {
    const sourcePath = chatsDir
      ? attachmentWikiPath(transcriptionData.sourceFile, chatsDir)
      : transcriptionData.sourceFile.replace(/\\/g, '/');
    lines.push(NOTE_LINE(`**Source:** ![[${sourcePath}]]`));
  }
  const transcriptText = String(transcriptionData.text || '').trim();
  if (transcriptText) {
    lines.push(NOTE_LINE());
    lines.push(NESTED_LINE('[!quote]- Transcript'));
    for (const line of transcriptText.split('\n')) {
      lines.push(NESTED_LINE(line));
    }
  }
  lines.push(NOTE_LINE());
  return `${lines.join('\n')}\n`;
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

async function renderLiveRecord(client, msg, paths, contactCache, existingOcr = null, existingTranscription = null) {
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
    block += formatOcrCalloutBlock(existingOcr, paths.chatsDir);
  }

  if (existingTranscription?.text) {
    block += formatTranscriptionCalloutBlock(existingTranscription, paths.chatsDir);
  }

  if (msg.body && !shouldSkipRedundantBody(msg.body, mediaState) && msg.type !== 'poll_creation' && msg.type !== 'reaction') {
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
  if (existingTranscription?.text) tags += ` #transcription`;
  block += formatTagsFooter(tags.replace(/^Tags:\s*/i, ''));
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
      const embedPath = mediaEmbedPath(destPath, paths.chatsDir);
      block += `> ![[${embedPath}]]\n>\n`;
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
  block += formatTagsFooter(`#sender/${safeTag} #imported`);
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
    const existingLiveAliases = new Set();
    for (const record of existingRecords.filter((entry) => entry.source === 'live')) {
      for (const alias of getRecordAliases(record)) existingLiveAliases.add(alias);
    }
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
      const existingTranscription = state.messages[msgId]?.transcription || null;

      const record = await renderLiveRecord(client, msg, paths, contactCache, existingOcr, existingTranscription);
      newRecords.push(record);
      state.messages[record.id] = {
        ...record.state,
        ocr: existingOcr,
        transcription: existingTranscription,
      };
      const isNew = ![...getRecordAliases(record)].some((alias) => existingLiveAliases.has(alias));
      if (isNew) newMessagesAdded++;
      changedIds.add(record.id);
    }

    const merged = mergeRecords(existingRecords, newRecords);
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
    sendProgress(mainWindow, 'Normalizing archive styles...', 95);
    const styleResult = normalizeArchiveStyles(paths, mainWindow);
    return { ...result, ...styleResult, backupDir };
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
    const transcription = state.messages?.[id]?.transcription || null;

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
      transcription,
    };
  }));
}
