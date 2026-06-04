import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import fs from 'fs';
import { archiveChat } from './archiver.js';
import { TelegramMessageAdapter } from './telegram-normalizer.js';
import {
  APP_TELEGRAM_TITLE,
  getTelegramApiId,
  getTelegramApiHash,
} from './telegram-config.js';

const TELEGRAM_APPS_URL = 'https://my.telegram.org/apps';

export function resolveTelegramApiCredentials() {
  const apiId = getTelegramApiId();
  const apiHash = getTelegramApiHash();

  if (!apiId || !apiHash) {
    return {
      error:
        'Telegram API credentials missing. Copy .env.example to .env in the project root and set TELEGRAM_API_ID and TELEGRAM_API_HASH from https://my.telegram.org/apps',
    };
  }

  return { apiId, apiHash };
}

export function formatTelegramError(err) {
  const msg = err?.message || String(err);
  if (msg.includes('API_ID_INVALID')) {
    return `Invalid Telegram API ID or API Hash. Check TELEGRAM_API_ID and TELEGRAM_API_HASH in your local .env file (${TELEGRAM_APPS_URL}).`;
  }
  if (msg.includes('credentials missing') || msg.includes('.env')) {
    return msg;
  }
  return msg;
}

export class TelegramArchiveClient {
  constructor(profileManager, mainWindow) {
    this.profileManager = profileManager;
    this.mainWindow = mainWindow;
    this.client = null;
    this.state = 'DISCONNECTED'; // DISCONNECTED | STARTING | NEED_PHONE | NEED_CODE | NEED_2FA | READY
    
    // Auth promise resolvers
    this.phoneResolver = null;
    this.codeResolver = null;
    this.passwordResolver = null;
    this.pendingPhone = null;
    this.pendingCode = null;
    this.pendingPassword = null;
    this._connectPromise = null;
  }

  send(channel, ...args) {
    this.mainWindow?.webContents?.send(channel, ...args);
  }

  normalizePhone(phone) {
    return String(phone).trim().replace(/[\s-]/g, '');
  }

  getStatus() {
    return {
      state: this.state,
      isReady: this.state === 'READY'
    };
  }

  async connect() {
    if (this.client && this.state === 'READY') {
      return;
    }
    if (this._connectPromise) {
      return this._connectPromise;
    }

    this._connectPromise = this._runConnect();
    try {
      await this._connectPromise;
    } finally {
      this._connectPromise = null;
    }
  }

  async _runConnect() {
    this.state = 'STARTING';
    this.send('telegram:status', this.getStatus());

    const activeProfile = this.profileManager.getActiveProfile();
    const sessionString = activeProfile.telegram?.session || '';

    const creds = resolveTelegramApiCredentials();
    if (creds.error) {
      this.state = 'DISCONNECTED';
      this.send('telegram:error', creds.error);
      this.send('telegram:status', this.getStatus());
      throw new Error(creds.error);
    }
    const { apiId, apiHash } = creds;

    this.client = new TelegramClient(
      new StringSession(sessionString),
      apiId,
      apiHash,
      {
        connectionRetries: 5,
        deviceModel: APP_TELEGRAM_TITLE,
        systemVersion: 'Windows 10',
        appVersion: '2.0.0',
      }
    );

    try {
      await this.client.start({
        phoneNumber: async () => {
          this.state = 'NEED_PHONE';
          this.send('telegram:needPhone');
          this.send('telegram:status', this.getStatus());
          if (this.pendingPhone) {
            const phone = this.pendingPhone;
            this.pendingPhone = null;
            return phone;
          }
          return new Promise(resolve => {
            this.phoneResolver = resolve;
          });
        },
        phoneCode: async () => {
          this.state = 'NEED_CODE';
          this.send('telegram:needCode');
          this.send('telegram:status', this.getStatus());
          if (this.pendingCode) {
            const code = this.pendingCode;
            this.pendingCode = null;
            return code;
          }
          return new Promise(resolve => {
            this.codeResolver = resolve;
          });
        },
        password: async () => {
          this.state = 'NEED_2FA';
          this.send('telegram:need2FA');
          this.send('telegram:status', this.getStatus());
          if (this.pendingPassword) {
            const password = this.pendingPassword;
            this.pendingPassword = null;
            return password;
          }
          return new Promise(resolve => {
            this.passwordResolver = resolve;
          });
        },
        onError: (err) => {
          console.error('Telegram auth error:', err);
          this.state = 'DISCONNECTED';
          this.send('telegram:error', formatTelegramError(err));
          this.send('telegram:status', this.getStatus());
        }
      });

      // Save StringSession to active profile
      const newSession = this.client.session.save();
      activeProfile.telegram = {
        ...activeProfile.telegram,
        session: newSession,
        enabled: true
      };
      this.profileManager.save();

      this.state = 'READY';
      this.send('telegram:ready', {
        id: (await this.client.getMe()).id.toString(),
        username: (await this.client.getMe()).username || 'Telegram User'
      });
      this.send('telegram:status', this.getStatus());

      // Pre-load dialogs to initialize update stream
      await this.client.getDialogs({ limit: 10 });
    } catch (error) {
      console.error('Failed to start Telegram client:', error);
      this.state = 'DISCONNECTED';
      this.send('telegram:error', formatTelegramError(error));
      this.send('telegram:status', this.getStatus());
      throw error;
    }
  }

  submitPhone(phone) {
    const normalized = this.normalizePhone(phone);
    if (this.phoneResolver) {
      this.phoneResolver(normalized);
      this.phoneResolver = null;
      this.pendingPhone = null;
    } else {
      this.pendingPhone = normalized;
    }
  }

  submitCode(code) {
    const normalized = String(code).trim();
    if (this.codeResolver) {
      this.codeResolver(normalized);
      this.codeResolver = null;
      this.pendingCode = null;
    } else {
      this.pendingCode = normalized;
    }
  }

  submit2FA(password) {
    const normalized = String(password).trim();
    if (this.passwordResolver) {
      this.passwordResolver(normalized);
      this.passwordResolver = null;
      this.pendingPassword = null;
    } else {
      this.pendingPassword = normalized;
    }
  }

  async logout() {
    if (this.client) {
      try {
        await this.client.destroy();
      } catch {
        // ignore
      }
      this.client = null;
    }
    
    this.state = 'DISCONNECTED';
    
    const activeProfile = this.profileManager.getActiveProfile();
    activeProfile.telegram = {
      ...activeProfile.telegram,
      session: '',
      enabled: false
    };
    this.profileManager.save();

    this.send('telegram:disconnected');
    this.send('telegram:status', this.getStatus());
  }

  async getChats() {
    if (!this.client || this.state !== 'READY') return [];
    try {
      const dialogs = await this.client.getDialogs({ limit: 100 });
      return dialogs.map(d => {
        const isGroup = d.isGroup || d.isChannel;
        let typeLabel = 'Contact';
        if (d.isGroup) typeLabel = 'Group';
        else if (d.isChannel) typeLabel = 'Channel';

        return {
          id: `tg:${d.id.toString()}`,
          name: d.title || d.name || 'Telegram Chat',
          isGroup: isGroup,
          isReadOnly: d.isChannel && !d.creator,
          archived: d.archived || false,
          pinned: d.pinned || false,
          unreadCount: d.unreadCount || 0,
          timestamp: d.date,
          typeLabel: typeLabel,
          avatarUrl: null // Avatars loaded lazily
        };
      });
    } catch (e) {
      console.error('Failed to fetch Telegram dialogs:', e);
      return [];
    }
  }

  async getAvatarUrl(chatId) {
    if (!this.client || this.state !== 'READY') return null;
    try {
      const entity = await this.client.getEntity(chatId);
      const photo = await this.client.downloadProfilePhoto(entity);
      if (photo) {
        return `data:image/jpeg;base64,${photo.toString('base64')}`;
      }
    } catch {
      // Ignore avatar fetch error
    }
    return null;
  }

  async archiveChat(chatId, vaultPath) {
    if (!this.client || this.state !== 'READY') throw new Error('Telegram client not ready');

    const activeProfile = this.profileManager.getActiveProfile();
    const rawChatId = chatId.startsWith('tg:') ? chatId.substring(3) : chatId;
    const chatEntity = await this.client.getEntity(rawChatId);
    
    // Fetch last 1000 messages for archive
    const messages = await this.client.getMessages(chatEntity, { limit: 1000 });
    const chatName = chatEntity.title || chatEntity.name || 'Telegram Chat';
    
    // Cache sender entities to prevent rate limiting
    const userCache = new Map();
    const wrappedMessages = [];
    
    for (const msg of messages) {
      let senderEntity = null;
      if (msg.senderId) {
        const senderIdStr = msg.senderId.toString();
        if (userCache.has(senderIdStr)) {
          senderEntity = userCache.get(senderIdStr);
        } else {
          try {
            senderEntity = await this.client.getEntity(msg.senderId);
            userCache.set(senderIdStr, senderEntity);
          } catch {
            // ignore
          }
        }
      }
      
      wrappedMessages.push(new TelegramMessageAdapter(this.client, msg, chatEntity, senderEntity));
    }
    
    // Call shared archive engine
    return await archiveChat(this.client, chatId, vaultPath, this.mainWindow, {
      messages: wrappedMessages,
      chatName: chatName,
      profileName: activeProfile.name,
      platform: 'telegram'
    });
  }

  async destroy() {
    if (this.client) {
      try {
        await this.client.destroy();
      } catch {
        // ignore
      }
      this.client = null;
    }
    this.state = 'DISCONNECTED';
    this.send('telegram:status', this.getStatus());
  }

  async getChatMessages(chatId, options = {}) {
    if (!this.client || this.state !== 'READY') throw new Error('Telegram client not ready');
    const rawChatId = chatId.startsWith('tg:') ? chatId.substring(3) : chatId;
    const chatEntity = await this.client.getEntity(rawChatId);
    const limit = Math.min(Number(options.limit) || 200, 1000);
    const messages = await this.client.getMessages(chatEntity, { limit });
    
    const userCache = new Map();
    
    // Resolve paths using archiver helper
    let state = { messages: {} };
    if (options.vaultPath) {
      try {
        const { resolveArchivePaths } = await import('./archiver.js');
        const paths = resolveArchivePaths(chatEntity.title || chatEntity.name || 'Telegram Chat', options.vaultPath, options.profileName, 'telegram');
        if (fs.existsSync(paths.stateFile)) {
          state = JSON.parse(fs.readFileSync(paths.stateFile, 'utf8'));
        }
      } catch (e) {
        console.warn('Failed to load Telegram archive state for message review:', e);
      }
    }

    const formatLocalDate = (date) => {
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    };

    const formattedMessages = [];
    for (const msg of messages) {
      let senderEntity = null;
      if (msg.senderId) {
        const senderIdStr = msg.senderId.toString();
        if (userCache.has(senderIdStr)) {
          senderEntity = userCache.get(senderIdStr);
        } else {
          try {
            senderEntity = await this.client.getEntity(msg.senderId);
            userCache.set(senderIdStr, senderEntity);
          } catch {
            // ignore
          }
        }
      }
      
      const adapter = new TelegramMessageAdapter(this.client, msg, chatEntity, senderEntity);
      const contact = await adapter.getContact();
      const date = new Date(msg.date * 1000);
      const id = adapter.id._serialized;
      
      const ocr = state.messages?.[id]?.ocr || null;
      
      formattedMessages.push({
        id,
        timestamp: date.getTime(),
        displayTime: formatLocalDate(date),
        senderName: contact.name,
        fromMe: adapter.fromMe,
        type: adapter.type,
        body: adapter.body || '',
        hasMedia: adapter.hasMedia,
        hasQuotedMsg: adapter.hasQuotedMsg,
        ocr,
      });
    }
    return formattedMessages;
  }

  setupWatcher(onMessage) {
    if (!this.client || this.state !== 'READY') return;
    
    this.client.addEventHandler(async (event) => {
      try {
        const msg = event.message;
        if (!msg) return;
        
        const peerId = msg.peerId;
        let peerIdStr = '';
        if (peerId) {
          if (peerId.userId) peerIdStr = peerId.userId.toString();
          else if (peerId.chatId) peerIdStr = peerId.chatId.toString();
          else if (peerId.channelId) peerIdStr = peerId.channelId.toString();
        }
        
        if (!peerIdStr) return;
        
        const chatEntity = await this.client.getEntity(peerIdStr);
        
        let senderEntity = null;
        if (msg.senderId) {
          try {
            senderEntity = await this.client.getEntity(msg.senderId);
          } catch {
            // Ignore fetch error
          }
        }
        
        const adapter = new TelegramMessageAdapter(this.client, msg, chatEntity, senderEntity);
        onMessage(adapter);
      } catch {
        // Error in Telegram watcher event handler
      }
    }, new NewMessage({}));
  }
}
