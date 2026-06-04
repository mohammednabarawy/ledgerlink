const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Vault Selection
  selectVault: () => ipcRenderer.invoke('dialog:selectVault'),
  
  // Profile Management
  getProfiles: () => ipcRenderer.invoke('profile:list'),
  getActiveProfile: () => ipcRenderer.invoke('profile:getActive'),
  createProfile: (name, vaultPath, icon, color) => ipcRenderer.invoke('profile:create', name, vaultPath, icon, color),
  updateProfile: (id, updates) => ipcRenderer.invoke('profile:update', id, updates),
  deleteProfile: (id) => ipcRenderer.invoke('profile:delete', id),
  switchProfile: (id) => ipcRenderer.invoke('profile:switch', id),
  getCachedChats: (platform) => ipcRenderer.invoke('chat:getCachedChats', platform),

  // WhatsApp Actions
  connectWhatsApp: () => ipcRenderer.invoke('whatsapp:connect'),
  getWhatsAppStatus: () => ipcRenderer.invoke('whatsapp:getStatus'),
  logout: () => ipcRenderer.invoke('whatsapp:logout'),
  getChats: () => ipcRenderer.invoke('whatsapp:getChats'),
  getChatAvatar: (chatId) => ipcRenderer.invoke('whatsapp:getChatAvatar', chatId),
  archiveChat: (chatId, vaultPath) => ipcRenderer.invoke('whatsapp:archiveChat', chatId, vaultPath),
  repairArchive: (chatId, vaultPath) => ipcRenderer.invoke('whatsapp:repairArchive', chatId, vaultPath),
  getChatMessages: (chatId, options) => ipcRenderer.invoke('whatsapp:getChatMessages', chatId, options),
  importHistory: (chatName, vaultPath) => ipcRenderer.invoke('whatsapp:importHistory', chatName, vaultPath),
  openInObsidian: (vaultPath) => ipcRenderer.invoke('obsidian:open', vaultPath),
  getWatcherStatus: () => ipcRenderer.invoke('watcher:getStatus'),
  setWatcherChatEnabled: (chatId, vaultPath, enabled) => ipcRenderer.invoke('watcher:setChatEnabled', chatId, vaultPath, enabled),
  setWatcherGlobalEnabled: (enabled, vaultPath) => ipcRenderer.invoke('watcher:setGlobalEnabled', enabled, vaultPath),
  ocrScanMessage: (chatId, messageId, vaultPath) => ipcRenderer.invoke('ocr:scanMessage', chatId, messageId, vaultPath),
  
  // Telegram Actions
  connectTelegram: () => ipcRenderer.invoke('telegram:connect'),
  getTelegramStatus: () => ipcRenderer.invoke('telegram:getStatus'),
  submitTelegramPhone: (phone) => ipcRenderer.invoke('telegram:submitPhone', phone),
  submitTelegramCode: (code) => ipcRenderer.invoke('telegram:submitCode', code),
  submitTelegram2FA: (password) => ipcRenderer.invoke('telegram:submit2FA', password),
  logoutTelegram: () => ipcRenderer.invoke('telegram:logout'),
  getTelegramChats: () => ipcRenderer.invoke('telegram:getChats'),
  archiveTelegramChat: (chatId, vaultPath) => ipcRenderer.invoke('telegram:archiveChat', chatId, vaultPath),
  setTelegramWatcherEnabled: (chatId, vaultPath, enabled) => ipcRenderer.invoke('telegram:setWatcherEnabled', chatId, vaultPath, enabled),
  setTelegramWatcherGlobalEnabled: (enabled, vaultPath) => ipcRenderer.invoke('telegram:setWatcherGlobalEnabled', enabled, vaultPath),

  // WhatsApp Events
  onQR: (callback) => ipcRenderer.on('whatsapp:qr', (_event, qr) => callback(qr)),
  onReady: (callback) => ipcRenderer.on('whatsapp:ready', (_event, info) => callback(info)),
  onAuthenticated: (callback) => ipcRenderer.on('whatsapp:authenticated', () => callback()),
  onAuthFailure: (callback) => ipcRenderer.on('whatsapp:auth_failure', (_event, msg) => callback(msg)),
  onDisconnected: (callback) => ipcRenderer.on('whatsapp:disconnected', (_event, reason) => callback(reason)),
  onWatcherStatus: (callback) => ipcRenderer.on('watcher:status', (_event, status) => callback(status)),
  onWatcherEvent: (callback) => ipcRenderer.on('watcher:event', (_event, data) => callback(data)),
  
  // Telegram Events
  onTelegramStatus: (callback) => ipcRenderer.on('telegram:status', (_event, status) => callback(status)),
  onTelegramNeedPhone: (callback) => ipcRenderer.on('telegram:needPhone', () => callback()),
  onTelegramNeedCode: (callback) => ipcRenderer.on('telegram:needCode', () => callback()),
  onTelegramNeed2FA: (callback) => ipcRenderer.on('telegram:need2FA', () => callback()),
  onTelegramReady: (callback) => ipcRenderer.on('telegram:ready', (_event, info) => callback(info)),
  onTelegramError: (callback) => ipcRenderer.on('telegram:error', (_event, msg) => callback(msg)),
  onTelegramDisconnected: (callback) => ipcRenderer.on('telegram:disconnected', (_event, reason) => callback(reason)),
  onTelegramWatcherStatus: (callback) => ipcRenderer.on('telegram:watcherStatus', (_event, status) => callback(status)),
  onTelegramWatcherEvent: (callback) => ipcRenderer.on('telegram:watcherEvent', (_event, data) => callback(data)),

  // Archive Events
  onArchiveProgress: (callback) => ipcRenderer.on('archive:progress', (_event, data) => callback(data)),
  onArchiveError: (callback) => ipcRenderer.on('archive:error', (_event, err) => callback(err)),
  
  // Clean up listeners
  removeListeners: () => {
    ipcRenderer.removeAllListeners('whatsapp:qr');
    ipcRenderer.removeAllListeners('whatsapp:ready');
    ipcRenderer.removeAllListeners('whatsapp:authenticated');
    ipcRenderer.removeAllListeners('whatsapp:auth_failure');
    ipcRenderer.removeAllListeners('whatsapp:disconnected');
    ipcRenderer.removeAllListeners('watcher:status');
    ipcRenderer.removeAllListeners('watcher:event');
    ipcRenderer.removeAllListeners('telegram:status');
    ipcRenderer.removeAllListeners('telegram:needPhone');
    ipcRenderer.removeAllListeners('telegram:needCode');
    ipcRenderer.removeAllListeners('telegram:need2FA');
    ipcRenderer.removeAllListeners('telegram:ready');
    ipcRenderer.removeAllListeners('telegram:error');
    ipcRenderer.removeAllListeners('telegram:disconnected');
    ipcRenderer.removeAllListeners('telegram:watcherStatus');
    ipcRenderer.removeAllListeners('telegram:watcherEvent');
    ipcRenderer.removeAllListeners('archive:progress');
    ipcRenderer.removeAllListeners('archive:error');
  }
});
