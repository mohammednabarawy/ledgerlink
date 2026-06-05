import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { urlToDataUrl, bufferToDataUrl } from './account-avatars.js';

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SAVE_DEBOUNCE_MS = 400;

const memoryCache = new Map();
const inflightFetches = new Map();

let cacheRoot = '';
let filesDir = '';
let indexPath = '';
/** @type {Record<string, { file: string, mime: string, updatedAt: number }>} */
let index = {};
let saveTimer = null;
let initialized = false;

function hashKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 40);
}

function isExpired(updatedAt) {
  return Date.now() - updatedAt > TTL_MS;
}

function loadIndex() {
  try {
    if (fs.existsSync(indexPath)) {
      index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    }
  } catch (error) {
    console.error('Failed to load avatar cache index:', error);
    index = {};
  }
}

function scheduleSaveIndex() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushAvatarCache();
  }, SAVE_DEBOUNCE_MS);
}

export function flushAvatarCache() {
  if (!initialized) return;
  try {
    fs.mkdirSync(filesDir, { recursive: true });
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to save avatar cache index:', error);
  }
}

function filePathForEntry(entry) {
  return path.join(filesDir, entry.file);
}

function readEntryAsDisplayUrl(entry) {
  const filePath = filePathForEntry(entry);
  if (!fs.existsSync(filePath)) return null;
  const buffer = fs.readFileSync(filePath);
  return bufferToDataUrl(buffer, entry.mime || 'image/jpeg');
}

function rememberInMemory(key, displayUrl) {
  memoryCache.set(key, { displayUrl, expiresAt: Date.now() + TTL_MS });
  return displayUrl;
}

async function bufferFromValue(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) {
    return value.length ? value : null;
  }
  if (typeof value === 'string') {
    if (value.startsWith('data:')) {
      const match = value.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return null;
      return Buffer.from(match[2], 'base64');
    }
    if (value.startsWith('http://') || value.startsWith('https://')) {
      const dataUrl = await urlToDataUrl(value);
      if (!dataUrl) return null;
      return bufferFromValue(dataUrl);
    }
    if (value.startsWith('file://')) {
      try {
        const filePath = decodeURIComponent(value.replace(/^file:\/\//, ''));
        if (fs.existsSync(filePath)) {
          return fs.readFileSync(filePath);
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function migrateLegacyJson(userDataPath) {
  const legacy = path.join(userDataPath, 'avatars-cache.json');
  if (!fs.existsSync(legacy)) return;

  try {
    const legacyData = JSON.parse(fs.readFileSync(legacy, 'utf8'));
    let migrated = 0;
    for (const [key, entry] of Object.entries(legacyData)) {
      if (!entry?.url || index[key]) continue;
      const buffer = await bufferFromValue(entry.url);
      if (buffer && buffer.length) {
        const file = `${hashKey(key)}.bin`;
        fs.writeFileSync(path.join(filesDir, file), buffer);
        index[key] = {
          file,
          mime: 'image/jpeg',
          updatedAt: entry.timestamp || Date.now(),
        };
        migrated++;
      }
    }
    if (migrated > 0) {
      scheduleSaveIndex();
      console.log(`Migrated ${migrated} avatars from legacy JSON cache to file store`);
    }
    fs.renameSync(legacy, `${legacy}.migrated`);
  } catch (error) {
    console.warn('Legacy avatar cache migration skipped:', error?.message || error);
  }
}

export function initAvatarCache(userDataPath) {
  if (initialized) return;
  cacheRoot = path.join(userDataPath, 'avatar-cache');
  filesDir = path.join(cacheRoot, 'files');
  indexPath = path.join(cacheRoot, 'index.json');

  fs.mkdirSync(filesDir, { recursive: true });
  loadIndex();
  migrateLegacyJson(userDataPath).catch((err) => {
    console.warn('Avatar cache migration error:', err?.message || err);
  });
  initialized = true;
}

/**
 * Read cached avatar URL for display in renderer (file:// or data:).
 */
export function getAvatarCache(key) {
  if (!key || !initialized) return null;

  const mem = memoryCache.get(key);
  if (mem && mem.expiresAt > Date.now()) {
    return mem.displayUrl;
  }
  if (mem) memoryCache.delete(key);

  const entry = index[key];
  if (!entry) return null;
  if (isExpired(entry.updatedAt)) {
    delete index[key];
    try {
      fs.unlinkSync(filePathForEntry(entry));
    } catch {
      // ignore
    }
    scheduleSaveIndex();
    return null;
  }

  const displayUrl = readEntryAsDisplayUrl(entry);
  if (!displayUrl) {
    delete index[key];
    scheduleSaveIndex();
    return null;
  }

  return rememberInMemory(key, displayUrl);
}

/**
 * Store avatar (Buffer, data URL, remote URL, or file URL).
 */
export async function setAvatarCache(key, value, mime = 'image/jpeg') {
  if (!key || !value || !initialized) return null;

  const buffer = await bufferFromValue(value);
  if (!buffer || !buffer.length) return null;

  const ext = mime.includes('png') ? 'png' : 'jpg';
  const file = `${hashKey(key)}.${ext}`;
  const filePath = path.join(filesDir, file);

  const old = index[key];
  if (old && old.file !== file) {
    try {
      fs.unlinkSync(filePathForEntry(old));
    } catch {
      // ignore
    }
  }

  fs.writeFileSync(filePath, buffer);
  index[key] = { file, mime, updatedAt: Date.now() };
  scheduleSaveIndex();

  return rememberInMemory(key, bufferToDataUrl(buffer, mime));
}

/**
 * Fetch only when cache miss; dedupe concurrent requests per key.
 */
export async function getOrSetAvatarCache(key, fetchFn) {
  const cached = getAvatarCache(key);
  if (cached) return cached;

  if (inflightFetches.has(key)) {
    return inflightFetches.get(key);
  }

  const promise = (async () => {
    try {
      const fresh = await fetchFn();
      if (!fresh) return null;
      return setAvatarCache(key, fresh);
    } finally {
      inflightFetches.delete(key);
    }
  })();

  inflightFetches.set(key, promise);
  return promise;
}

export function enrichChatsWithCachedAvatars(chats) {
  if (!Array.isArray(chats)) return [];
  return chats.map((chat) => ({
    ...chat,
    avatarUrl: getAvatarCache(chat.id) || chat.avatarUrl || null,
  }));
}

export function accountCacheKey(platform, profileId) {
  return `account:${platform}:${profileId}`;
}

export function clearAvatarCacheKey(key) {
  memoryCache.delete(key);
  const entry = index[key];
  if (entry) {
    try {
      fs.unlinkSync(filePathForEntry(entry));
    } catch {
      // ignore
    }
    delete index[key];
    scheduleSaveIndex();
  }
}
