/**
 * Telegram app metadata and API credential resolution.
 * Credentials are stored in global app settings (userData), not in the shipped app.
 */
export const APP_TELEGRAM_TITLE = 'ledgerlink';

let credentialsProvider = null;

export function setTelegramCredentialsProvider(provider) {
  credentialsProvider = provider;
}

function readFromProvider() {
  if (!credentialsProvider) return null;
  const creds = credentialsProvider();
  if (!creds?.apiId || !creds?.apiHash) return null;
  const apiId = parseInt(String(creds.apiId).trim(), 10);
  const apiHash = String(creds.apiHash).trim();
  if (!Number.isFinite(apiId) || apiId <= 0 || !apiHash) return null;
  return { apiId, apiHash };
}

function readFromEnv() {
  const raw = process.env.TELEGRAM_API_ID;
  const hash = String(process.env.TELEGRAM_API_HASH || '').trim();
  if (!raw || !hash) return null;
  const apiId = parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(apiId) || apiId <= 0) return null;
  return { apiId, apiHash: hash };
}

export function getTelegramApiId() {
  return readFromProvider()?.apiId ?? readFromEnv()?.apiId ?? null;
}

export function getTelegramApiHash() {
  return readFromProvider()?.apiHash ?? readFromEnv()?.apiHash ?? null;
}

export function hasTelegramApiCredentials() {
  return getTelegramApiId() !== null && !!getTelegramApiHash();
}
