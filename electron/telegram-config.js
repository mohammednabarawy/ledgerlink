/**
 * Non-secret Telegram app metadata. API credentials live only in .env (gitignored).
 * @see .env.example
 */
export const APP_TELEGRAM_TITLE = 'ledgerlink';

export function getTelegramApiId() {
  const raw = process.env.TELEGRAM_API_ID;
  if (!raw) return null;
  const id = parseInt(String(raw).trim(), 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function getTelegramApiHash() {
  const hash = String(process.env.TELEGRAM_API_HASH || '').trim();
  return hash || null;
}

export function hasTelegramApiCredentials() {
  return getTelegramApiId() !== null && getTelegramApiHash() !== null;
}
