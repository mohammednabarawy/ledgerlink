/**
 * Scans a packaged Windows build for secrets, sessions, or personal runtime data.
 */
const fs = require('fs');
const path = require('path');

const releaseRoot = path.join(__dirname, '..', 'release');
const unpackedCandidates = [
  path.join(releaseRoot, 'win-unpacked'),
  path.join(releaseRoot, 'win-arm64-unpacked'),
];

function findUnpackedDir() {
  for (const candidate of unpackedCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const entries = fs.existsSync(releaseRoot) ? fs.readdirSync(releaseRoot) : [];
  const match = entries.find((name) => name.endsWith('-unpacked'));
  if (match) return path.join(releaseRoot, match);
  return null;
}

const SENSITIVE_PATH_PARTS = [
  'WhatsAppAuth',
  'TelegramSessions',
  'profiles.json',
  'avatars-cache.json',
  'avatar-cache',
  '.wwebjs_cache',
];

const SENSITIVE_FILE_NAMES = new Set([
  '.env',
  'profiles.json',
  'avatars-cache.json',
]);

const CONTENT_PATTERNS = [
  { name: 'Telegram session string', regex: /1[A-Za-z0-9_-]{20,}==/ },
  { name: 'Telegram API hash', regex: /TELEGRAM_API_HASH\s*=\s*[a-f0-9]{16,}/i },
  { name: 'Telegram API id', regex: /TELEGRAM_API_ID\s*=\s*\d{4,}/i },
];

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else {
      files.push(full);
    }
  }
  return files;
}

function isTextCandidate(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (['.exe', '.dll', '.pak', '.bin', '.png', '.jpg', '.jpeg', '.ico', '.woff', '.woff2'].includes(ext)) {
    return false;
  }
  return true;
}

function main() {
  const unpacked = findUnpackedDir();
  if (!unpacked) {
    console.error('No unpacked Windows build found under release/. Run npm run dist:win first.');
    process.exit(1);
  }

  const issues = [];
  const files = walk(unpacked);

  for (const file of files) {
    const rel = path.relative(unpacked, file).replace(/\\/g, '/');
    const base = path.basename(file);

    if (SENSITIVE_FILE_NAMES.has(base) && base !== 'env.example') {
      issues.push(`Sensitive file packaged: ${rel}`);
    }

    for (const part of SENSITIVE_PATH_PARTS) {
      if (rel.includes(part)) {
        issues.push(`Sensitive path packaged: ${rel}`);
      }
    }

    if (!isTextCandidate(file)) continue;

    let content = '';
    try {
      const stat = fs.statSync(file);
      if (stat.size > 2 * 1024 * 1024) continue;
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    for (const pattern of CONTENT_PATTERNS) {
      if (pattern.regex.test(content)) {
        issues.push(`${pattern.name} found in ${rel}`);
      }
    }
  }

  if (issues.length) {
    console.error('Release safety check FAILED:');
    for (const issue of issues) console.error(`  - ${issue}`);
    process.exit(1);
  }

  console.log('Release safety check passed for', unpacked);
}

main();
