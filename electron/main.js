import { loadEnv } from './load-env.js';
loadEnv();

import { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeImage } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import fs from 'fs';
import { archiveChat, getChatMessages, importHistory, repairArchiveOrder, resolveArchivePaths } from './archiver.js';
import { ProfileManager } from './profile-manager.js';
import { runOCR } from './ocr-engine.js';
import { extractReceiptFields } from './ocr-extractor.js';
import { detectDocumentOcrSupport, runDocumentOCR } from './document-ocr.js';
import { detectTranscriptionStack, getDownloadedModels, downloadWhisperModel } from './transcription-service.js';
import { TelegramArchiveClient } from './telegram-client.js';
import { urlToDataUrl } from './account-avatars.js';
import {
  initAvatarCache,
  getAvatarCache,
  setAvatarCache,
  getOrSetAvatarCache,
  enrichChatsWithCachedAvatars,
  accountCacheKey,
  flushAvatarCache,
} from './avatar-cache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let whatsappClient;
let waState = 'DISCONNECTED';
let currentQr = null;
let profileManager;
let telegramClient;

let watcherSettings = { globalEnabled: false, vaultPath: null, enabledChatIds: [] };
const watcherTimers = new Map();
const archiveQueues = new Map();
const watcherMessageQueues = new Map();
const backgroundOcrQueues = new Map();
const backgroundOcrStatus = new Map();

const OCR_IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|webp|tif|tiff)$/i;
const OCR_DOCUMENT_EXTENSIONS = /\.(pdf|doc|docx)$/i;
const TRANSCRIPTION_FILE_EXTENSIONS = /\.(opus|mp3|m4a|ogg|wav|mp4|mov|mkv|webm)$/i;

process.on('uncaughtException', (error) => {
  console.error('Uncaught main process exception:', error);
  mainWindow?.webContents?.send('app:error', error.message || String(error));
  mainWindow?.setProgressBar?.(-1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled main process rejection:', reason);
  mainWindow?.webContents?.send('app:error', reason?.message || String(reason));
  mainWindow?.setProgressBar?.(-1);
});

function appIconPath() {
  return path.join(__dirname, '../public/ledgerlink_logo.png');
}

async function getOrFetchAvatar(chatId) {
  return getOrSetAvatarCache(chatId, async () => {
    if (!whatsappClient || (waState !== 'READY' && waState !== 'AUTHENTICATED')) return null;
    try {
      return await whatsappClient.getProfilePicUrl(chatId);
    } catch {
      return null;
    }
  });
}

async function fetchWhatsAppAccountAvatarDataUrl(profileId) {
  if (!whatsappClient?.info?.wid) return null;
  const contactId = whatsappClient.info.wid._serialized;
  if (!contactId) return null;

  const cacheKey = accountCacheKey('whatsapp', profileId);
  return getOrSetAvatarCache(cacheKey, async () => {
    if (waState !== 'READY' && waState !== 'AUTHENTICATED') return null;
    try {
      const remoteUrl = await whatsappClient.getProfilePicUrl(contactId);
      if (!remoteUrl) return null;
      return (await urlToDataUrl(remoteUrl)) || remoteUrl;
    } catch (error) {
      console.warn('WhatsApp account profile pic failed:', error?.message || error);
      return null;
    }
  });
}

function buildWhatsAppAccountInfo(profilePicUrl) {
  if (!whatsappClient?.info) return null;
  const info = whatsappClient.info;
  return {
    pushname: info.pushname || info.name || 'WhatsApp',
    profilePicUrl: profilePicUrl || null,
    id: info.wid?._serialized || null,
  };
}

async function resolveWhatsAppAccountInfo() {
  if (!whatsappClient?.info || (waState !== 'READY' && waState !== 'AUTHENTICATED')) {
    return null;
  }
  const profileId = profileManager.getActiveProfileId();
  const pic = await fetchWhatsAppAccountAvatarDataUrl(profileId);
  return buildWhatsAppAccountInfo(pic);
}

function createWindow() {
  const icon = nativeImage.createFromPath(appIconPath());
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 680,
    title: 'LedgerLink',
    frame: false,
    backgroundColor: '#020617',
    show: false,
    icon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  Menu.setApplicationMenu(null);
  app.setName('LedgerLink');
  if (process.platform === 'win32') app.setAppUserModelId('com.ledgerlink.desktop');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:state', { maximized: true });
  });
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:state', { maximized: false });
  });

  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

function loadWatcherSettings() {
  try {
    const activeProfile = profileManager.getActiveProfile();
    if (activeProfile) {
      watcherSettings = {
        globalEnabled: !!activeProfile.whatsapp?.watcher?.globalEnabled,
        vaultPath: activeProfile.vaultPath || null,
        enabledChatIds: Array.isArray(activeProfile.whatsapp?.watcher?.enabledChatIds)
          ? activeProfile.whatsapp.watcher.enabledChatIds
          : [],
      };
    }
  } catch (error) {
    console.error('Failed to load watcher settings:', error);
  }
}

function saveWatcherSettings() {
  try {
    const activeProfile = profileManager.getActiveProfile();
    if (activeProfile) {
      activeProfile.vaultPath = watcherSettings.vaultPath;
      if (!activeProfile.whatsapp) activeProfile.whatsapp = {};
      if (!activeProfile.whatsapp.watcher) activeProfile.whatsapp.watcher = {};
      activeProfile.whatsapp.watcher.globalEnabled = watcherSettings.globalEnabled;
      activeProfile.whatsapp.watcher.enabledChatIds = watcherSettings.enabledChatIds;
      profileManager.save();
    }
  } catch (error) {
    console.error('Failed to save watcher settings:', error);
  }
}

function watcherStatus(extra = {}) {
  return {
    ...watcherSettings,
    isReady: waState === 'READY',
    ...extra,
  };
}

function sendWatcherEvent(payload) {
  mainWindow?.webContents?.send('watcher:event', payload);
}

let telegramWatcherSettings = { globalEnabled: false, vaultPath: null, enabledChatIds: [] };

function loadTelegramWatcherSettings() {
  try {
    const activeProfile = profileManager.getActiveProfile();
    if (activeProfile) {
      telegramWatcherSettings = {
        globalEnabled: !!activeProfile.telegram?.watcher?.globalEnabled,
        vaultPath: activeProfile.vaultPath || null,
        enabledChatIds: Array.isArray(activeProfile.telegram?.watcher?.enabledChatIds)
          ? activeProfile.telegram.watcher.enabledChatIds
          : [],
      };
    }
  } catch (error) {
    console.error('Failed to load Telegram watcher settings:', error);
  }
}

function saveTelegramWatcherSettings() {
  try {
    const activeProfile = profileManager.getActiveProfile();
    if (activeProfile) {
      activeProfile.vaultPath = telegramWatcherSettings.vaultPath;
      if (!activeProfile.telegram) activeProfile.telegram = {};
      if (!activeProfile.telegram.watcher) activeProfile.telegram.watcher = {};
      activeProfile.telegram.watcher.globalEnabled = telegramWatcherSettings.globalEnabled;
      activeProfile.telegram.watcher.enabledChatIds = telegramWatcherSettings.enabledChatIds;
      profileManager.save();
    }
  } catch (error) {
    console.error('Failed to save Telegram watcher settings:', error);
  }
}

function telegramWatcherStatus(extra = {}) {
  return {
    ...telegramWatcherSettings,
    isReady: telegramClient && telegramClient.state === 'READY',
    ...extra,
  };
}

function sendTelegramWatcherEvent(payload) {
  mainWindow?.webContents?.send('watcher:event', payload);
  mainWindow?.webContents?.send('telegram:watcherEvent', payload);
}

function readArchiveStateFile(stateFile) {
  if (!fs.existsSync(stateFile)) return { processedIds: [], messages: {}, imports: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    return {
      processedIds: parsed.processedIds || [],
      messages: parsed.messages || {},
      imports: parsed.imports || {},
      ...parsed,
    };
  } catch {
    return { processedIds: [], messages: {}, imports: {} };
  }
}

function writeArchiveStateFile(stateFile, state) {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
}

function ocrCalloutBlock(ocrData) {
  const lines = [
    `> [!receipt] **OCR Extracted** - Confidence: ${Math.round(ocrData.confidence || 0)}%`,
  ];
  if (ocrData.imageFile) lines.push(`> **Source attachment:** ![[${ocrData.imageFile.replace(/\\/g, '/')}]]`);
  if (ocrData.vendor) lines.push(`> **Vendor:** ${ocrData.vendor}`);
  if (ocrData.date) lines.push(`> **Date:** ${ocrData.date}`);
  if (ocrData.total) lines.push(`> **Total:** ${ocrData.currency || 'SAR'} ${ocrData.total}`);
  if (ocrData.tax) lines.push(`> **VAT/Tax:** ${ocrData.currency || 'SAR'} ${ocrData.tax}`);
  lines.push('>');
  lines.push('> <details><summary>Full OCR Text</summary>');
  lines.push('>');
  for (const line of String(ocrData.text || '').split('\n')) {
    lines.push(`> ${line}`);
  }
  lines.push('>');
  lines.push('> </details>');
  lines.push('>');
  return `${lines.join('\n')}\n`;
}

function injectOcrIntoMarkdown(paths, messageId, ocrData) {
  if (!fs.existsSync(paths.chatsDir)) return false;
  const marker = `<!-- wa:id: ${messageId} -->`;
  for (const filename of fs.readdirSync(paths.chatsDir).filter(name => name.endsWith('.md'))) {
    const filePath = path.join(paths.chatsDir, filename);
    const content = fs.readFileSync(filePath, 'utf8');
    const markerIndex = content.indexOf(marker);
    if (markerIndex === -1) continue;

    const blockStart = content.lastIndexOf('\n---\n', markerIndex);
    const normalizedStart = blockStart === -1 ? 0 : blockStart + 5;
    const blockEnd = content.indexOf('\n---\n', markerIndex);
    const normalizedEnd = blockEnd === -1 ? content.length : blockEnd + 5;
    let block = content.slice(normalizedStart, normalizedEnd);

    block = block.replace(/\n?> \[!receipt\] \*\*OCR Extracted\*\*[\s\S]*?> <\/details>\n?>\n?/g, '\n');
    const callout = ocrCalloutBlock(ocrData);
    const mediaLine = block.match(/^> !\[\[[^\]]+\]\]\n>\n/m);
    if (mediaLine?.index !== undefined) {
      const insertAt = mediaLine.index + mediaLine[0].length;
      block = `${block.slice(0, insertAt)}${callout}${block.slice(insertAt)}`;
    } else {
      const noteHeader = block.indexOf('>\n');
      const insertAt = noteHeader === -1 ? 0 : noteHeader + 2;
      block = `${block.slice(0, insertAt)}${callout}${block.slice(insertAt)}`;
    }

    fs.writeFileSync(filePath, `${content.slice(0, normalizedStart)}${block}${content.slice(normalizedEnd)}`, 'utf8');
    return true;
  }
  return false;
}

function emitBackgroundOcrStatus(chatId, patch) {
  const prev = backgroundOcrStatus.get(chatId) || { chatId, status: 'idle', progress: 0 };
  const next = { ...prev, ...patch, chatId, updatedAt: new Date().toISOString() };
  backgroundOcrStatus.set(chatId, next);
  if (mainWindow?.setProgressBar && typeof next.progress === 'number' && next.status === 'running') {
    mainWindow.setProgressBar(next.progress > 0 && next.progress < 100 ? next.progress / 100 : -1);
  }
  mainWindow?.webContents?.send('ocr:backgroundStatus', next);
  return next;
}

function resolveOcrCandidates(paths, state) {
  return Object.entries(state.messages || {})
    .map(([id, record]) => ({ id, record }))
    .filter(({ record }) => {
      const rel = record?.media?.relativePath;
      if (!rel || record.ocr) return false;
      return OCR_IMAGE_EXTENSIONS.test(rel);
    });
}

function resolveDocumentOcrCandidates(state) {
  return Object.entries(state.messages || {})
    .map(([id, record]) => ({ id, record }))
    .filter(({ record }) => {
      const rel = record?.media?.relativePath;
      if (!rel || record.ocr) return false;
      return OCR_DOCUMENT_EXTENSIONS.test(rel);
    });
}

function buildOcrData(rel, ocrResult, extra = {}) {
  const extracted = extractReceiptFields(ocrResult.text);
  return {
    confidence: ocrResult.confidence,
    text: ocrResult.text,
    imageFile: rel.replace(/\\/g, '/'),
    ...extra,
    ...extracted,
  };
}

function resolveTranscriptionCandidates(state) {
  return Object.entries(state.messages || {})
    .map(([id, record]) => ({ id, record }))
    .filter(({ record }) => {
      const rel = record?.media?.relativePath;
      if (!rel || record.transcription) return false;
      return TRANSCRIPTION_FILE_EXTENSIONS.test(rel);
    });
}

async function runBackgroundOcrForArchive({ chatId, vaultPath, platform, chatName }) {
  const activeProfile = profileManager.getActiveProfile();
  const chatOrName = chatName || 'Chat';
  const paths = resolveArchivePaths(chatOrName, vaultPath, activeProfile.name, platform);
  const state = readArchiveStateFile(paths.stateFile);
  const imageCandidates = resolveOcrCandidates(paths, state).map(candidate => ({ ...candidate, kind: 'image' }));
  const documentCandidates = resolveDocumentOcrCandidates(state).map(candidate => ({ ...candidate, kind: 'document' }));
  const candidates = [...imageCandidates, ...documentCandidates];
  const transcriptionPending = resolveTranscriptionCandidates(state).length;
  const documentTotal = documentCandidates.length;

  if (!candidates.length) {
    emitBackgroundOcrStatus(chatId, {
      status: 'idle',
      progress: 100,
      current: 'No pending OCR attachments',
      total: 0,
      done: 0,
      failed: 0,
      documentPending: 0,
      documentDone: 0,
      documentFailed: 0,
      transcriptionPending,
    });
    return { total: 0, done: 0, failed: 0, documentPending: 0, documentDone: 0, documentFailed: 0, transcriptionPending };
  }

  let done = 0;
  let failed = 0;
  let documentDone = 0;
  let documentFailed = 0;
  emitBackgroundOcrStatus(chatId, {
    status: 'running',
    progress: 0,
    total: candidates.length,
    done,
    failed,
    current: 'Starting background OCR',
    documentPending: documentTotal,
    documentDone,
    documentFailed,
    transcriptionPending,
  });

  for (const { id, record, kind } of candidates) {
    const rel = record.media.relativePath;
    const absolutePath = path.join(paths.baseDir, rel);
    try {
      emitBackgroundOcrStatus(chatId, {
        status: 'running',
        current: path.basename(rel),
        progress: Math.round(((done + failed) / candidates.length) * 100),
      });
      if (!fs.existsSync(absolutePath)) throw new Error('Attachment file missing');

      const ocrLang = activeProfile.ocr?.language || 'eng+ara';
      const runner = kind === 'document' ? runDocumentOCR : runOCR;
      const ocrResult = await runner(absolutePath, ocrLang, {
        onProgress: (event) => {
          const itemProgress = typeof event.progress === 'number' ? event.progress : 0;
          const overall = ((done + failed + itemProgress) / candidates.length) * 100;
          emitBackgroundOcrStatus(chatId, {
            status: 'running',
            current: `${path.basename(rel)} · ${event.status || 'recognizing text'}`,
            progress: Math.max(1, Math.min(99, Math.round(overall))),
            documentPending: Math.max(0, documentTotal - documentDone - documentFailed),
            documentDone,
            documentFailed,
          });
        },
      });
      const ocrData = buildOcrData(rel, ocrResult, {
        sourceType: kind === 'document' ? ocrResult.sourceType : 'image',
        pageCount: ocrResult.pageCount,
        renderedPages: ocrResult.renderedPages,
      });
      state.messages[id] = { ...record, ocr: ocrData };
      injectOcrIntoMarkdown(paths, id, ocrData);
      done++;
      if (kind === 'document') documentDone++;
      writeArchiveStateFile(paths.stateFile, state);
    } catch (error) {
      failed++;
      if (kind === 'document') documentFailed++;
      state.messages[id] = {
        ...record,
        ocrError: {
          message: error.message,
          at: new Date().toISOString(),
          file: rel,
        },
      };
      writeArchiveStateFile(paths.stateFile, state);
      emitBackgroundOcrStatus(chatId, {
        status: 'running',
        current: `${path.basename(rel)} · ${error.message}`,
        progress: Math.max(1, Math.min(99, Math.round(((done + failed) / candidates.length) * 100))),
        documentPending: Math.max(0, documentTotal - documentDone - documentFailed),
        documentDone,
        documentFailed,
      });
    }
  }

  emitBackgroundOcrStatus(chatId, {
    status: 'complete',
    progress: 100,
    current: 'Background OCR complete',
    total: candidates.length,
    done,
    failed,
    documentPending: Math.max(0, documentTotal - documentDone - documentFailed),
    documentDone,
    documentFailed,
    transcriptionPending,
  });
  mainWindow?.setProgressBar?.(-1);
  return {
    total: candidates.length,
    done,
    failed,
    documentPending: Math.max(0, documentTotal - documentDone - documentFailed),
    documentDone,
    documentFailed,
    transcriptionPending,
  };
}

function scheduleBackgroundOcr(job) {
  if (!job?.chatId || !job?.vaultPath) return;
  const id = profileManager?.getActiveProfileId?.();
  const storedProfile = id ? profileManager.config.profiles[id] : null;
  if (storedProfile) {
    storedProfile.ocr = {
      language: 'eng+ara',
      confidenceThreshold: 60,
      ...storedProfile.ocr,
      autoScan: true,
    };
    profileManager.save();
  }
  const existing = backgroundOcrQueues.get(job.chatId) || Promise.resolve();
  const next = existing
    .catch(() => {})
    .then(() => runBackgroundOcrForArchive(job))
    .catch((error) => {
      emitBackgroundOcrStatus(job.chatId, {
        status: 'failed',
        progress: 100,
        current: error.message,
        error: error.message,
      });
    });
  backgroundOcrQueues.set(job.chatId, next);
}

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window:maximizeToggle', () => {
  if (!mainWindow) return { maximized: false };
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
  return { maximized: mainWindow.isMaximized() };
});

ipcMain.handle('window:close', () => {
  mainWindow?.close();
});

ipcMain.handle('window:getState', () => ({
  maximized: !!mainWindow?.isMaximized(),
}));

function setupTelegramWatcherHandlers(client) {
  client.setupWatcher((adapter) => {
    const fullChatId = `tg:${adapter.chatPeerId || adapter.chatEntity.id.toString()}`;
    
    if (!fullChatId || !telegramWatcherSettings.globalEnabled || !telegramWatcherSettings.vaultPath) return;
    if (!telegramWatcherSettings.enabledChatIds.includes(fullChatId)) return;

    if (!watcherMessageQueues.has(fullChatId)) {
      watcherMessageQueues.set(fullChatId, []);
    }
    watcherMessageQueues.get(fullChatId).push(adapter);

    if (watcherTimers.has(fullChatId)) clearTimeout(watcherTimers.get(fullChatId));
    sendTelegramWatcherEvent({ chatId: fullChatId, source: 'message', status: 'queued', at: new Date().toISOString() });
    
    watcherTimers.set(fullChatId, setTimeout(() => {
      watcherTimers.delete(fullChatId);
      const msgs = watcherMessageQueues.get(fullChatId) || [];
      watcherMessageQueues.delete(fullChatId);

      if (msgs.length === 0) return;

      enqueueArchive(fullChatId, async () => {
        try {
          sendTelegramWatcherEvent({ chatId: fullChatId, source: 'message', status: 'archiving', at: new Date().toISOString() });
          const activeProfile = profileManager.getActiveProfile();
          await archiveChat(client.client, fullChatId, telegramWatcherSettings.vaultPath, mainWindow, {
            messages: msgs,
            chatName: adapter.chatEntity.title || adapter.chatEntity.name || 'Telegram Chat',
            profileName: activeProfile.name,
            platform: 'telegram'
          });
          scheduleBackgroundOcr({
            chatId: fullChatId,
            vaultPath: telegramWatcherSettings.vaultPath,
            platform: 'telegram',
            chatName: adapter.chatEntity.title || adapter.chatEntity.name || 'Telegram Chat',
          });
          sendTelegramWatcherEvent({ chatId: fullChatId, source: 'message', status: 'archived', at: new Date().toISOString() });
        } catch (error) {
          sendTelegramWatcherEvent({ chatId: fullChatId, source: 'message', status: 'failed', error: error.message, at: new Date().toISOString() });
        }
      });
    }, 1500));
  });
}

// Chat list cache functions
function getChatsCachePath(profileId, platform) {
  return path.join(app.getPath('userData'), `chats-cache-${profileId}-${platform}.json`);
}

function loadChatsFromCache(profileId, platform) {
  try {
    const cachePath = getChatsCachePath(profileId, platform);
    if (fs.existsSync(cachePath)) {
      return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    }
  } catch (error) {
    console.error(`Failed to load chats cache for ${platform}:`, error);
  }
  return [];
}

function saveChatsToCache(profileId, platform, chats) {
  try {
    const cachePath = getChatsCachePath(profileId, platform);
    fs.writeFileSync(cachePath, JSON.stringify(chats, null, 2), 'utf8');
  } catch (error) {
    console.error(`Failed to save chats cache for ${platform}:`, error);
  }
}

function enqueueArchive(chatId, task) {
  const previous = archiveQueues.get(chatId) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(task)
    .finally(() => {
      if (archiveQueues.get(chatId) === next) archiveQueues.delete(chatId);
    });
  archiveQueues.set(chatId, next);
  return next;
}

function chatIdForMessage(msg) {
  if (msg.fromMe) return msg.to;
  return msg.from;
}

function setupWatcherHandlers(client) {
  const scheduleMessage = (msg, source) => {
    if (!msg) return;
    const chatId = chatIdForMessage(msg);
    if (!chatId || !watcherSettings.globalEnabled || !watcherSettings.vaultPath) return;
    if (!watcherSettings.enabledChatIds.includes(chatId)) return;

    if (!watcherMessageQueues.has(chatId)) {
      watcherMessageQueues.set(chatId, []);
    }
    watcherMessageQueues.get(chatId).push(msg);

    if (watcherTimers.has(chatId)) clearTimeout(watcherTimers.get(chatId));
    sendWatcherEvent({ chatId, source, status: 'queued', at: new Date().toISOString() });
    
    watcherTimers.set(chatId, setTimeout(() => {
      watcherTimers.delete(chatId);
      const msgs = watcherMessageQueues.get(chatId) || [];
      watcherMessageQueues.delete(chatId);

      if (msgs.length === 0) return;

      enqueueArchive(chatId, async () => {
        try {
          sendWatcherEvent({ chatId, source, status: 'archiving', at: new Date().toISOString() });
          const activeProfile = profileManager.getActiveProfile();
          const chat = await msgs[0]?.getChat?.();
          await archiveChat(client, chatId, watcherSettings.vaultPath, mainWindow, {
            messages: msgs,
            chat,
            profileName: activeProfile.name,
            platform: 'whatsapp'
          });
          scheduleBackgroundOcr({
            chatId,
            vaultPath: watcherSettings.vaultPath,
            platform: 'whatsapp',
            chatName: chat?.name || 'WhatsApp Chat',
          });
          sendWatcherEvent({ chatId, source, status: 'archived', at: new Date().toISOString() });
        } catch (error) {
          sendWatcherEvent({ chatId, source, status: 'failed', error: error.message, at: new Date().toISOString() });
        }
      });
    }, 1500));
  };

  client.on('message', msg => scheduleMessage(msg, 'message'));
  client.on('message_create', msg => scheduleMessage(msg, 'message_create'));
  client.on('message_edit', msg => scheduleMessage(msg, 'message_edit'));
  client.on('message_revoke_everyone', (after, before) => scheduleMessage(after || before, 'message_revoke_everyone'));
}

async function connectWhatsApp() {
  if (whatsappClient) {
    return;
  }

  waState = 'STARTING';
  
  const activeProfile = profileManager.getActiveProfile();
  const authDataFolder = activeProfile.whatsapp?.authDataPath || `WhatsAppAuth/${activeProfile.id}`;

  whatsappClient = new Client({
    authStrategy: new LocalAuth({ 
      dataPath: path.join(app.getPath('userData'), authDataFolder) 
    }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

  whatsappClient.on('qr', (qr) => {
    console.log('QR RECEIVED');
    waState = 'QR';
    currentQr = qr;
    mainWindow.webContents.send('whatsapp:qr', qr);
  });

  whatsappClient.on('ready', async () => {
    console.log('WhatsApp Client is ready!');
    waState = 'READY';
    currentQr = null;
    
    const info = await resolveWhatsAppAccountInfo();
    mainWindow.webContents.send('whatsapp:ready', info);
    mainWindow.webContents.send('watcher:status', watcherStatus());
  });

  whatsappClient.on('authenticated', () => {
    console.log('AUTHENTICATED');
    waState = 'AUTHENTICATED';
    currentQr = null;
    mainWindow.webContents.send('whatsapp:authenticated');
    resolveWhatsAppAccountInfo()
      .then((info) => {
        if (info) mainWindow?.webContents?.send('whatsapp:accountInfo', info);
      })
      .catch(() => {});
  });

  whatsappClient.on('auth_failure', msg => {
    console.error('AUTHENTICATION FAILURE', msg);
    waState = 'DISCONNECTED';
    mainWindow.webContents.send('whatsapp:auth_failure', msg);
  });

  whatsappClient.on('disconnected', (reason) => {
    console.log('Client was logged out', reason);
    waState = 'DISCONNECTED';
    currentQr = null;
    whatsappClient.destroy();
    whatsappClient = null;
    mainWindow.webContents.send('whatsapp:disconnected', reason);
    mainWindow.webContents.send('watcher:status', watcherStatus());
  });

  setupWatcherHandlers(whatsappClient);

  try {
    await whatsappClient.initialize();
  } catch (error) {
    console.error('Failed to initialize WhatsApp Client:', error);
    waState = 'DISCONNECTED';
  }
}

async function connectTelegram() {
  if (!telegramClient) {
    telegramClient = new TelegramArchiveClient(profileManager, mainWindow);
  }
  telegramClient.mainWindow = mainWindow;
  
  telegramClient.connect().then(() => {
    if (telegramClient.state === 'READY') {
      setupTelegramWatcherHandlers(telegramClient);
    }
  }).catch(err => {
    console.error('Telegram connect error:', err);
  });
}

app.whenReady().then(() => {
  const userDataPath = app.getPath('userData');
  profileManager = new ProfileManager(userDataPath);
  initAvatarCache(userDataPath);

  // Run vault migrations for all profile vaults if configured
  for (const p of profileManager.listProfiles()) {
    if (p.vaultPath) {
      profileManager.migrateVault(p.vaultPath);
    }
  }

  loadWatcherSettings();
  loadTelegramWatcherSettings();
  createWindow();
  telegramClient = new TelegramArchiveClient(profileManager, mainWindow);

  // Autoconnect watchers if enabled on startup
  if (watcherSettings.globalEnabled) {
    connectWhatsApp().catch(err => console.error('Failed to autoconnect WhatsApp on startup:', err));
  }
  if (profileManager.hasTelegramSession()) {
    connectTelegram().catch(err => console.error('Failed to autoconnect Telegram on startup:', err));
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  flushAvatarCache();
});

// --- IPC Handlers ---

// Profile IPCs
ipcMain.handle('profile:list', async () => {
  return profileManager.listProfiles();
});

ipcMain.handle('profile:getActive', async () => {
  return profileManager.getActiveProfile();
});

ipcMain.handle('profile:create', async (event, name, vaultPath, icon, color) => {
  const profile = profileManager.createProfile(name, vaultPath, icon, color);
  if (profile.vaultPath) {
    profileManager.migrateVault(profile.vaultPath);
  }
  return profile;
});

ipcMain.handle('profile:update', async (event, id, updates) => {
  const profile = profileManager.updateProfile(id, updates);
  if (id === profileManager.config.activeProfileId) {
    if (updates.vaultPath) {
      watcherSettings.vaultPath = updates.vaultPath;
      telegramWatcherSettings.vaultPath = updates.vaultPath;
      profileManager.migrateVault(updates.vaultPath);
    }
    loadWatcherSettings();
    loadTelegramWatcherSettings();
  }
  return profile;
});

ipcMain.handle('profile:delete', async (event, id) => {
  const success = profileManager.deleteProfile(id);
  if (success && id === profileManager.config.activeProfileId) {
    loadWatcherSettings();
    loadTelegramWatcherSettings();
    if (whatsappClient) {
      try {
        whatsappClient.destroy();
      } catch {
        // ignore
      }
      whatsappClient = null;
      waState = 'DISCONNECTED';
      currentQr = null;
      mainWindow?.webContents?.send('whatsapp:disconnected', 'Profile deleted');
    }
    if (telegramClient) {
      try {
        await telegramClient.destroy();
      } catch {
        // ignore
      }
      telegramClient = null;
      mainWindow?.webContents?.send('telegram:disconnected', 'Profile deleted');
    }
  }
  return success;
});

ipcMain.handle('profile:switch', async (event, profileId) => {
  if (profileManager.config.activeProfileId === profileId) {
    return profileManager.getActiveProfile();
  }

  if (whatsappClient) {
    try {
      whatsappClient.destroy();
    } catch (e) {
      console.error('Error destroying whatsapp client on switch:', e);
    }
    whatsappClient = null;
  }
  waState = 'DISCONNECTED';
  currentQr = null;
  if (telegramClient) {
    try {
      await telegramClient.destroy();
    } catch (e) {
      console.error('Error destroying telegram client on switch:', e);
    }
    telegramClient = null;
  }

  const profile = profileManager.switchProfile(profileId);
  loadWatcherSettings();
  loadTelegramWatcherSettings();
  
  telegramClient = new TelegramArchiveClient(profileManager, mainWindow);

  if (profile.vaultPath) {
    profileManager.migrateVault(profile.vaultPath);
  }

  // Autoconnect on switch if watcher is globally enabled for the switched profile
  if (watcherSettings.globalEnabled) {
    connectWhatsApp().catch(err => console.error('Failed to autoconnect WhatsApp on profile switch:', err));
  }
  if (profileManager.hasTelegramSession(profileId)) {
    connectTelegram().catch(err => console.error('Failed to autoconnect Telegram on profile switch:', err));
  }

  mainWindow?.webContents?.send('whatsapp:disconnected', 'Profile switch');
  mainWindow?.webContents?.send('telegram:disconnected', 'Profile switch');
  mainWindow?.webContents?.send('watcher:status', watcherStatus());
  mainWindow?.webContents?.send('telegram:watcherStatus', telegramWatcherStatus());

  return profile;
});

// Vault dialog
ipcMain.handle('dialog:selectVault', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select or Create Obsidian Vault for Archive',
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    const selectedPath = result.filePaths[0];
    const activeProfile = profileManager.getActiveProfile();
    if (activeProfile) {
      profileManager.migrateVault(selectedPath);
    }
    return selectedPath;
  }
  return null;
});

// WhatsApp Auth & Connection
ipcMain.handle('whatsapp:connect', async () => {
  await connectWhatsApp();
});

ipcMain.handle('whatsapp:getStatus', async () => {
  const info = await resolveWhatsAppAccountInfo();
  return { state: waState, qr: currentQr, info };
});

ipcMain.handle('whatsapp:getAccountInfo', async () => {
  return resolveWhatsAppAccountInfo();
});

// Chats - INSTANT load optimization
ipcMain.handle('whatsapp:getChats', async () => {
  if (!whatsappClient) throw new Error('WhatsApp client not initialized');
  const chats = await whatsappClient.getChats();
  
  const formattedChats = chats.map(c => {
    const id = c.id._serialized;
    return {
      id,
      name: c.name,
      isGroup: c.isGroup,
      isReadOnly: c.isReadOnly,
      archived: c.archived,
      pinned: c.pinned,
      unreadCount: c.unreadCount,
      timestamp: c.timestamp,
      typeLabel: c.isGroup ? 'Group' : 'Contact',
      avatarUrl: getAvatarCache(id),
    };
  });

  const activeProfile = profileManager.getActiveProfile();
  const enriched = enrichChatsWithCachedAvatars(formattedChats);
  saveChatsToCache(activeProfile.id, 'whatsapp', enriched);

  return enriched;
});

async function getOrFetchTelegramChatAvatar(chatId) {
  if (!telegramClient || telegramClient.state !== 'READY') {
    return getAvatarCache(chatId);
  }
  return getOrSetAvatarCache(chatId, () => telegramClient.getAvatarUrl(chatId));
}

// On-demand avatar fetch (WhatsApp + Telegram chat ids)
ipcMain.handle('whatsapp:getChatAvatar', async (event, chatId) => {
  if (chatId.startsWith('tg:')) {
    return getOrFetchTelegramChatAvatar(chatId);
  }
  return getOrFetchAvatar(chatId);
});

// Archival & Repair
ipcMain.handle('whatsapp:archiveChat', async (event, chatId, vaultPath) => {
  if (!whatsappClient) throw new Error('WhatsApp client not initialized');
  const activeProfile = profileManager.getActiveProfile();
  const chat = await whatsappClient.getChatById(chatId);
  const result = await enqueueArchive(chatId, () => archiveChat(whatsappClient, chatId, vaultPath, mainWindow, {
    chat,
    profileName: activeProfile.name,
    platform: 'whatsapp'
  }));
  scheduleBackgroundOcr({
    chatId,
    vaultPath,
    platform: 'whatsapp',
    chatName: chat.name,
  });
  return result;
});

ipcMain.handle('whatsapp:repairArchive', async (event, chatId, vaultPath) => {
  if (!whatsappClient) throw new Error('WhatsApp client not initialized');
  const activeProfile = profileManager.getActiveProfile();
  return await enqueueArchive(chatId, () => repairArchiveOrder(whatsappClient, chatId, vaultPath, mainWindow, {
    profileName: activeProfile.name,
    platform: 'whatsapp'
  }));
});

ipcMain.handle('whatsapp:getChatMessages', async (event, chatId, options = {}) => {
  if (chatId.startsWith('tg:')) {
    const activeProfile = profileManager.getActiveProfile();
    return await telegramClient.getChatMessages(chatId, {
      ...options,
      vaultPath: activeProfile.vaultPath,
      profileName: activeProfile.name
    });
  }
  if (!whatsappClient) throw new Error('WhatsApp client not initialized');
  const activeProfile = profileManager.getActiveProfile();
  return await getChatMessages(whatsappClient, chatId, {
    ...options,
    vaultPath: activeProfile.vaultPath,
    profileName: activeProfile.name
  });
});

ipcMain.handle('whatsapp:importHistory', async (event, chatName, vaultPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Text Files', extensions: ['txt'] }],
    title: 'Select exported WhatsApp _chat.txt'
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    const activeProfile = profileManager.getActiveProfile();
    return await importHistory(chatName, vaultPath, result.filePaths[0], mainWindow, {
      profileName: activeProfile.name,
      platform: 'whatsapp'
    });
  }
  return null;
});

// Watcher Controls
ipcMain.handle('watcher:getStatus', async (event, platform) => {
  if (platform === 'telegram') return telegramWatcherStatus();
  return watcherStatus();
});

ipcMain.handle('watcher:setChatEnabled', async (event, chatId, vaultPath, enabled) => {
  if (chatId.startsWith('tg:')) {
    if (vaultPath) telegramWatcherSettings.vaultPath = vaultPath;
    const set = new Set(telegramWatcherSettings.enabledChatIds);
    if (enabled) set.add(chatId);
    else set.delete(chatId);
    telegramWatcherSettings.enabledChatIds = [...set];
    telegramWatcherSettings.globalEnabled = telegramWatcherSettings.enabledChatIds.length > 0;
    saveTelegramWatcherSettings();
    const status = telegramWatcherStatus();
    mainWindow.webContents.send('telegram:watcherStatus', status);
    mainWindow.webContents.send('watcher:status', status);
    if (enabled && telegramClient?.state === 'READY') {
      try {
        const rawChatId = chatId.substring(3);
        const chatEntity = await telegramClient.client.getEntity(rawChatId);
        scheduleBackgroundOcr({
          chatId,
          vaultPath: telegramWatcherSettings.vaultPath,
          platform: 'telegram',
          chatName: chatEntity.title || chatEntity.name || 'Telegram Chat',
        });
      } catch {
        // OCR can resume after the next archive event.
      }
    }
    return status;
  } else {
    if (vaultPath) watcherSettings.vaultPath = vaultPath;
    const set = new Set(watcherSettings.enabledChatIds);
    if (enabled) set.add(chatId);
    else set.delete(chatId);
    watcherSettings.enabledChatIds = [...set];
    watcherSettings.globalEnabled = watcherSettings.enabledChatIds.length > 0;
    saveWatcherSettings();
    const status = watcherStatus();
    mainWindow.webContents.send('watcher:status', status);
    if (enabled && whatsappClient) {
      try {
        const chat = await whatsappClient.getChatById(chatId);
        scheduleBackgroundOcr({
          chatId,
          vaultPath: watcherSettings.vaultPath,
          platform: 'whatsapp',
          chatName: chat.name,
        });
      } catch {
        // OCR can resume after the next archive event.
      }
    }
    return status;
  }
});

ipcMain.handle('watcher:setGlobalEnabled', async (event, enabled, vaultPath, platform) => {
  if (platform === 'telegram') {
    telegramWatcherSettings.globalEnabled = !!enabled;
    if (vaultPath) telegramWatcherSettings.vaultPath = vaultPath;
    saveTelegramWatcherSettings();
    const status = telegramWatcherStatus();
    mainWindow.webContents.send('telegram:watcherStatus', status);
    mainWindow.webContents.send('watcher:status', status);
    return status;
  } else {
    watcherSettings.globalEnabled = !!enabled;
    if (vaultPath) watcherSettings.vaultPath = vaultPath;
    saveWatcherSettings();
    const status = watcherStatus();
    mainWindow.webContents.send('watcher:status', status);
    return status;
  }
});

ipcMain.handle('ocr:getBackgroundStatus', async (event, chatId) => {
  if (chatId) {
    return backgroundOcrStatus.get(chatId) || { chatId, status: 'idle', progress: 0 };
  }
  return Object.fromEntries(backgroundOcrStatus.entries());
});

ipcMain.handle('ocr:startBackgroundForChat', async (event, chatId, vaultPath) => {
  const activeProfile = profileManager.getActiveProfile();
  const platform = chatId.startsWith('tg:') ? 'telegram' : 'whatsapp';
  let chatName;
  if (platform === 'telegram') {
    if (!telegramClient || telegramClient.state !== 'READY') throw new Error('Telegram client not ready');
    const chatEntity = await telegramClient.client.getEntity(chatId.substring(3));
    chatName = chatEntity.title || chatEntity.name || 'Telegram Chat';
  } else {
    if (!whatsappClient) throw new Error('WhatsApp client not initialized');
    const chat = await whatsappClient.getChatById(chatId);
    chatName = chat.name;
  }
  scheduleBackgroundOcr({
    chatId,
    vaultPath: vaultPath || activeProfile.vaultPath,
    platform,
    chatName,
  });
  return backgroundOcrStatus.get(chatId) || { chatId, status: 'queued', progress: 0 };
});

ipcMain.handle('services:getLocalCapabilities', async () => {
  const [documentOcr, transcription] = await Promise.all([
    detectDocumentOcrSupport(),
    detectTranscriptionStack(app.getPath('userData')),
  ]);
  return { documentOcr, transcription };
});

// Generic Cache IPC
ipcMain.handle('chat:getCachedChats', async (event, platform) => {
  const activeProfile = profileManager.getActiveProfile();
  const chats = loadChatsFromCache(activeProfile.id, platform);
  return enrichChatsWithCachedAvatars(chats);
});

// Obsidian & logout
ipcMain.handle('obsidian:open', async (event, vaultPath) => {
  const uri = `obsidian://open?path=${encodeURIComponent(vaultPath)}`;
  await shell.openExternal(uri);
});

ipcMain.handle('whatsapp:logout', async () => {
  if (whatsappClient) {
    try {
      await whatsappClient.logout();
    } catch (error) {
      console.error('Logout failed:', error);
    }
  }
});

// --- Telegram Core ---
ipcMain.handle('telegram:connect', async () => {
  await connectTelegram();
  return telegramClient.getStatus();
});

ipcMain.handle('telegram:getStatus', async () => {
  if (!telegramClient) {
    return { state: 'DISCONNECTED', hasStoredSession: profileManager.hasTelegramSession() };
  }
  if (telegramClient.state === 'READY') {
    await telegramClient.refreshAccountInfo();
  }
  return {
    ...telegramClient.getStatus(),
    hasStoredSession: profileManager.hasTelegramSession(),
  };
});

ipcMain.handle('telegram:hasSession', async () => {
  return profileManager.hasTelegramSession();
});

ipcMain.handle('telegram:getAccountInfo', async () => {
  if (!telegramClient || telegramClient.state !== 'READY') return null;
  return telegramClient.refreshAccountInfo();
});

ipcMain.handle('telegram:submitPhone', async (event, phone) => {
  if (telegramClient) telegramClient.submitPhone(phone);
});

ipcMain.handle('telegram:submitCode', async (event, code) => {
  if (telegramClient) telegramClient.submitCode(code);
});

ipcMain.handle('telegram:submit2FA', async (event, password) => {
  if (telegramClient) telegramClient.submit2FA(password);
});

ipcMain.handle('telegram:logout', async () => {
  if (telegramClient) await telegramClient.logout();
  return telegramClient?.getStatus() || { state: 'DISCONNECTED' };
});

ipcMain.handle('telegram:getChats', async () => {
  if (!telegramClient) return [];
  const chats = await telegramClient.getChats();
  const activeProfile = profileManager.getActiveProfile();
  for (const chat of chats) {
    if (chat.avatarUrl) {
      await setAvatarCache(chat.id, chat.avatarUrl);
    }
  }
  const enriched = enrichChatsWithCachedAvatars(chats);
  saveChatsToCache(activeProfile.id, 'telegram', enriched);
  flushAvatarCache();
  return enriched;
});

ipcMain.handle('telegram:archiveChat', async (event, chatId, vaultPath) => {
  if (!telegramClient) throw new Error('Telegram client not initialized');
  const result = await telegramClient.archiveChat(chatId, vaultPath);
  const rawChatId = chatId.startsWith('tg:') ? chatId.substring(3) : chatId;
  const chatEntity = await telegramClient.client.getEntity(rawChatId);
  scheduleBackgroundOcr({
    chatId,
    vaultPath,
    platform: 'telegram',
    chatName: chatEntity.title || chatEntity.name || 'Telegram Chat',
  });
  return result;
});

ipcMain.handle('telegram:setWatcherEnabled', async (event, chatId, vaultPath, enabled) => {
  if (vaultPath) telegramWatcherSettings.vaultPath = vaultPath;
  const set = new Set(telegramWatcherSettings.enabledChatIds);
  if (enabled) set.add(chatId);
  else set.delete(chatId);
  telegramWatcherSettings.enabledChatIds = [...set];
  telegramWatcherSettings.globalEnabled = telegramWatcherSettings.enabledChatIds.length > 0;
  saveTelegramWatcherSettings();
  const status = telegramWatcherStatus();
  mainWindow.webContents.send('telegram:watcherStatus', status);
  mainWindow.webContents.send('watcher:status', status);
  return status;
});

ipcMain.handle('telegram:setWatcherGlobalEnabled', async (event, enabled, vaultPath) => {
  telegramWatcherSettings.globalEnabled = !!enabled;
  if (vaultPath) telegramWatcherSettings.vaultPath = vaultPath;
  saveTelegramWatcherSettings();
  const status = telegramWatcherStatus();
  mainWindow.webContents.send('telegram:watcherStatus', status);
  mainWindow.webContents.send('watcher:status', status);
  return status;
});

ipcMain.handle('ocr:scanMessage', async (event, chatId, messageId, vaultPath) => {
  const sendOcrProgress = (payload) => {
    if (mainWindow?.setProgressBar && typeof payload.progress === 'number') {
      mainWindow.setProgressBar(payload.progress > 0 && payload.progress < 100 ? payload.progress / 100 : -1);
    }
    mainWindow?.webContents?.send('ocr:progress', {
      chatId,
      messageId,
      ...payload,
    });
  };

  try {
    sendOcrProgress({ status: 'Preparing OCR scan...', progress: 5, phase: 'prepare' });
    const activeProfile = profileManager.getActiveProfile();
    const isTelegram = chatId.startsWith('tg:');
    let chatName = 'Telegram Chat';
    let paths;
    
    if (isTelegram) {
      const rawChatId = chatId.substring(3);
      const chatEntity = await telegramClient.client.getEntity(rawChatId);
      chatName = chatEntity.title || chatEntity.name || 'Telegram Chat';
      paths = resolveArchivePaths(chatName, vaultPath, activeProfile.name, 'telegram');
    } else {
      const chat = await whatsappClient.getChatById(chatId);
      chatName = chat.name;
      paths = resolveArchivePaths(chat, vaultPath, activeProfile.name, 'whatsapp');
    }
    
    const stateFile = paths.stateFile;
    let state = { processedIds: [], messages: {}, imports: {} };
    if (fs.existsSync(stateFile)) {
      try {
        state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      } catch {
        // ignore
      }
    }
    sendOcrProgress({ status: 'Finding archived attachment...', progress: 15, phase: 'locate' });

    const shortId = messageId.split(':').pop() || messageId;
    const attachmentExtensions = /\.(jpg|jpeg|png|webp|tif|tiff|pdf|doc|docx)$/i;
    const stateMedia = state.messages?.[messageId]?.media;
    let attachmentPath = null;

    if (stateMedia?.relativePath && attachmentExtensions.test(stateMedia.relativePath)) {
      const candidate = path.join(paths.baseDir, stateMedia.relativePath);
      if (fs.existsSync(candidate)) attachmentPath = candidate;
    }

    if (!attachmentPath && fs.existsSync(paths.mediaDir)) {
      const stack = [paths.mediaDir, paths.docsDir];
      while (stack.length && !attachmentPath) {
        const dir = stack.pop();
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            stack.push(fullPath);
          } else if (attachmentExtensions.test(entry.name) && (entry.name.startsWith(shortId) || entry.name.includes(shortId))) {
            attachmentPath = fullPath;
            break;
          }
        }
      }
    }
    
    if (!attachmentPath) {
      throw new Error(`Attachment file for message ${messageId} was not found in the archive. Archive this chat again so media metadata is refreshed, then retry OCR.`);
    }
    
    const ocrLang = activeProfile.ocr?.language || 'eng+ara';
    sendOcrProgress({ status: 'Recognizing text...', progress: 30, phase: 'recognize' });
    const isDocument = OCR_DOCUMENT_EXTENSIONS.test(attachmentPath);
    const ocrResult = await (isDocument ? runDocumentOCR : runOCR)(attachmentPath, ocrLang, {
      onProgress: (event) => {
        const recognitionProgress = typeof event.progress === 'number'
          ? 30 + Math.round(event.progress * 45)
          : 30;
        sendOcrProgress({
          status: event.status || 'Recognizing text...',
          progress: Math.min(75, recognitionProgress),
          phase: 'recognize',
        });
      },
    });
    sendOcrProgress({ status: 'Extracting receipt fields...', progress: 78, phase: 'extract' });
    const ocrData = buildOcrData(path.relative(paths.baseDir, attachmentPath), ocrResult, {
      sourceType: isDocument ? ocrResult.sourceType : 'image',
      pageCount: ocrResult.pageCount,
      renderedPages: ocrResult.renderedPages,
    });
    
    if (!state.messages) state.messages = {};
    if (!state.messages[messageId]) {
      state.messages[messageId] = {
        id: messageId,
        legacyId: shortId,
        timestamp: Date.now(),
        monthKey: new Date().toISOString().substring(0, 7),
      };
    }
    state.messages[messageId].ocr = ocrData;
    sendOcrProgress({ status: 'Saving OCR result...', progress: 84, phase: 'save' });
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
    
    // Re-render chat to write the OCR block to Markdown
    sendOcrProgress({ status: 'Updating archive note...', progress: 90, phase: 'archive' });
    if (isTelegram) {
      // Re-archive Telegram chat
      await telegramClient.archiveChat(chatId, vaultPath);
    } else {
      let msg = null;
      try {
        const msgs = await whatsappClient.getChatById(chatId).then(c => c.fetchMessages({ limit: 100 }));
        msg = msgs.find(m => (m.id?._serialized || m.id?.id) === messageId);
      } catch (e) {
        console.warn('Could not fetch message for re-render, running repair fallback:', e);
      }
      
      if (msg) {
        await archiveChat(whatsappClient, chatId, vaultPath, mainWindow, {
          singleMessage: msg,
          profileName: activeProfile.name,
          platform: 'whatsapp'
        });
      } else {
        await repairArchiveOrder(whatsappClient, chatId, vaultPath, mainWindow, {
          profileName: activeProfile.name,
          platform: 'whatsapp'
        });
      }
    }
    sendOcrProgress({ status: 'OCR complete.', progress: 100, phase: 'complete' });
    
    return { success: true, ocrData };
  } catch (error) {
    console.error('OCR scan failed:', error);
    sendOcrProgress({ status: error.message || 'OCR failed.', progress: 100, phase: 'error', error: error.message });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('profile:getGlobalSettings', () => profileManager.getGlobalSettings());
ipcMain.handle('profile:updateGlobalSettings', (event, updates) => profileManager.updateGlobalSettings(updates));

ipcMain.handle('services:getWhisperModels', () => {
  return getDownloadedModels(app.getPath('userData'));
});

ipcMain.handle('services:downloadWhisperModel', async (event, modelSize) => {
  return downloadWhisperModel(modelSize, app.getPath('userData'), (progressInfo) => {
    mainWindow?.webContents?.send('services:modelDownloadProgress', progressInfo);
  });
});

