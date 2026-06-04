import { loadEnv } from './load-env.js';
loadEnv();

import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import fs from 'fs';
import { archiveChat, getChatMessages, importHistory, repairArchiveOrder, resolveArchivePaths } from './archiver.js';
import { ProfileManager } from './profile-manager.js';
import { runOCR } from './ocr-engine.js';
import { extractReceiptFields } from './ocr-extractor.js';
import { TelegramArchiveClient } from './telegram-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let whatsappClient;
let waState = 'DISCONNECTED';
let currentQr = null;
let profilePicUrl = null;
let profileManager;
let telegramClient;

let watcherSettings = { globalEnabled: false, vaultPath: null, enabledChatIds: [] };
const watcherTimers = new Map();
const archiveQueues = new Map();
const watcherMessageQueues = new Map();

// Avatar cache
const AVATAR_CACHE_FILE = path.join(app.getPath('userData'), 'avatars-cache.json');
let avatarDiskCache = {};

function loadAvatarCache() {
  try {
    if (fs.existsSync(AVATAR_CACHE_FILE)) {
      avatarDiskCache = JSON.parse(fs.readFileSync(AVATAR_CACHE_FILE, 'utf8'));
    }
  } catch (error) {
    console.error('Failed to load avatar disk cache:', error);
  }
}

function saveAvatarCache() {
  try {
    fs.writeFileSync(AVATAR_CACHE_FILE, JSON.stringify(avatarDiskCache, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to save avatar disk cache:', error);
  }
}

function getCachedAvatar(chatId) {
  const cacheEntry = avatarDiskCache[chatId];
  if (cacheEntry && cacheEntry.url) {
    // Cache validity: 3 days (3 * 24 * 60 * 60 * 1000 ms)
    const age = Date.now() - cacheEntry.timestamp;
    if (age < 259200000) {
      return cacheEntry.url;
    }
  }
  return null;
}

async function getOrFetchAvatar(chatId) {
  const cached = getCachedAvatar(chatId);
  if (cached) return cached;

  if (!whatsappClient || waState !== 'READY') return null;
  try {
    const url = await whatsappClient.getProfilePicUrl(chatId);
    if (url) {
      avatarDiskCache[chatId] = {
        url,
        timestamp: Date.now()
      };
      saveAvatarCache();
      return url;
    }
  } catch {
    // Ignore error
  }
  return null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
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

function setupTelegramWatcherHandlers(client) {
  client.setupWatcher((adapter) => {
    const fullChatId = `tg:${adapter.chatEntity.id.toString()}`;
    
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
          await archiveChat(client, chatId, watcherSettings.vaultPath, mainWindow, {
            messages: msgs,
            profileName: activeProfile.name,
            platform: 'whatsapp'
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
    
    try {
      profilePicUrl = await getOrFetchAvatar(whatsappClient.info.wid._serialized);
    } catch {
      console.log('Could not fetch profile pic');
    }
    
    const info = {
      ...whatsappClient.info,
      profilePicUrl
    };
    mainWindow.webContents.send('whatsapp:ready', info);
    mainWindow.webContents.send('watcher:status', watcherStatus());
  });

  whatsappClient.on('authenticated', () => {
    console.log('AUTHENTICATED');
    waState = 'AUTHENTICATED';
    currentQr = null;
    mainWindow.webContents.send('whatsapp:authenticated');
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
    profilePicUrl = null;
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
  await telegramClient.connect();
  if (telegramClient.state === 'READY') {
    setupTelegramWatcherHandlers(telegramClient);
  }
}

app.whenReady().then(() => {
  profileManager = new ProfileManager(app.getPath('userData'));
  loadAvatarCache();

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
  const activeProfile = profileManager.getActiveProfile();
  if (watcherSettings.globalEnabled) {
    connectWhatsApp().catch(err => console.error('Failed to autoconnect WhatsApp on startup:', err));
  }
  if (telegramWatcherSettings.globalEnabled && activeProfile.telegram?.session) {
    connectTelegram().catch(err => console.error('Failed to autoconnect Telegram on startup:', err));
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
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
  profilePicUrl = null;

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
  if (telegramWatcherSettings.globalEnabled && profile.telegram?.session) {
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
  let info = null;
  if (whatsappClient && whatsappClient.info) {
    info = { ...whatsappClient.info, profilePicUrl };
  }
  return { state: waState, qr: currentQr, info };
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
      avatarUrl: getCachedAvatar(id) // Instant cache lookup (no network await!)
    };
  });

  const activeProfile = profileManager.getActiveProfile();
  saveChatsToCache(activeProfile.id, 'whatsapp', formattedChats);

  return formattedChats;
});

// On-demand Avatar fetch
ipcMain.handle('whatsapp:getChatAvatar', async (event, chatId) => {
  if (chatId.startsWith('tg:')) {
    const rawId = chatId.substring(3);
    return await telegramClient?.getAvatarUrl(rawId);
  }
  return await getOrFetchAvatar(chatId);
});

// Archival & Repair
ipcMain.handle('whatsapp:archiveChat', async (event, chatId, vaultPath) => {
  if (!whatsappClient) throw new Error('WhatsApp client not initialized');
  const activeProfile = profileManager.getActiveProfile();
  return await enqueueArchive(chatId, () => archiveChat(whatsappClient, chatId, vaultPath, mainWindow, {
    profileName: activeProfile.name,
    platform: 'whatsapp'
  }));
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

// Generic Cache IPC
ipcMain.handle('chat:getCachedChats', async (event, platform) => {
  const activeProfile = profileManager.getActiveProfile();
  return loadChatsFromCache(activeProfile.id, platform);
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
  if (!telegramClient) return { state: 'DISCONNECTED' };
  return telegramClient.getStatus();
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
  saveChatsToCache(activeProfile.id, 'telegram', chats);
  return chats;
});

ipcMain.handle('telegram:archiveChat', async (event, chatId, vaultPath) => {
  if (!telegramClient) throw new Error('Telegram client not initialized');
  return await telegramClient.archiveChat(chatId, vaultPath);
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
  try {
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
    
    const shortId = messageId.split(':').pop() || messageId;
    
    if (!fs.existsSync(paths.mediaDir)) {
      throw new Error(`Media directory not found. Please archive the chat first.`);
    }
    const files = fs.readdirSync(paths.mediaDir);
    const imageFile = files.find(f => f.startsWith(shortId) && /\.(jpg|jpeg|png)$/i.test(f));
    
    if (!imageFile) {
      throw new Error(`Image file for message ${messageId} not found in archive. Please make sure the chat is archived first.`);
    }
    
    const imagePath = path.join(paths.mediaDir, imageFile);
    
    // Run OCR
    const ocrLang = activeProfile.ocr?.language || 'eng+ara';
    const ocrResult = await runOCR(imagePath, ocrLang);
    const extracted = extractReceiptFields(ocrResult.text);
    
    const ocrData = {
      confidence: ocrResult.confidence,
      text: ocrResult.text,
      ...extracted
    };
    
    // Save to state
    const stateFile = paths.stateFile;
    let state = { processedIds: [], messages: {}, imports: {} };
    if (fs.existsSync(stateFile)) {
      try {
        state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      } catch {
        // ignore
      }
    }
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
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
    
    // Re-render chat to write the OCR block to Markdown
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
    
    return { success: true, ocrData };
  } catch (error) {
    console.error('OCR scan failed:', error);
    return { success: false, error: error.message };
  }
});
