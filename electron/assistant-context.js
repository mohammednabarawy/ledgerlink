const TONE_LABELS = {
  professional: 'professional and courteous',
  friendly: 'warm and friendly',
  concise: 'brief and to the point',
  formal: 'formal and business-like',
};

const SYSTEM_PROMPT = `You are a reply assistant inside LedgerLink, a desktop app for archiving WhatsApp and Telegram chats into Obsidian. The user needs help drafting a reply in an ongoing conversation. Use the transcript for context only. Do not invent facts, amounts, dates, or commitments not supported by the chat. Match the user's typical tone when they have sent messages before. Output ONLY the reply text(s) requested — no meta commentary or explanations.`;

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function messageLine(msg, includeOcr) {
  const sender = msg.fromMe ? 'You' : (msg.senderName || 'Unknown');
  let body = msg.body?.trim() || '';

  if (!body && msg.hasMedia) {
    body = `[${msg.type || 'media'} message]`;
  }

  if (includeOcr && msg.ocr?.text) {
    const snippet = String(msg.ocr.text).slice(0, 400).replace(/\s+/g, ' ').trim();
    if (snippet) body += body ? ` (OCR: ${snippet})` : `OCR: ${snippet}`;
  }

  if (!body) return null;

  return `[${msg.displayTime || 'unknown time'}] ${sender}: ${body}`;
}

function detectReplyLanguage(messages, preference) {
  if (preference && preference !== 'auto') {
    return preference === 'ar' ? 'Arabic' : 'English';
  }

  const sample = messages
    .filter((m) => m.fromMe && m.body)
    .slice(-5)
    .map((m) => m.body)
    .join(' ');

  const arabicChars = (sample.match(/[\u0600-\u06FF]/g) || []).length;
  const latinChars = (sample.match(/[A-Za-z]/g) || []).length;

  if (arabicChars > latinChars) return 'Arabic';
  if (latinChars > 0) return 'English';
  return 'the same language as the conversation';
}

export function buildReplyPrompt({
  chatName = 'Chat',
  platform = 'whatsapp',
  chatType = 'contact',
  messages = [],
  targetMessageId = null,
  tone = 'professional',
  instruction = '',
  replyLanguage = 'auto',
  maxContextMessages = 40,
  includeOcrText = true,
  draftCount = 3,
  ocrEnrichment = {},
}) {
  const enriched = messages.map((msg) => ({
    ...msg,
    ocr: msg.ocr || ocrEnrichment[msg.id] || null,
  }));

  let anchorIndex = enriched.length - 1;
  if (targetMessageId) {
    const idx = enriched.findIndex((m) => m.id === targetMessageId);
    if (idx >= 0) anchorIndex = idx;
  } else {
    for (let i = enriched.length - 1; i >= 0; i -= 1) {
      if (!enriched[i].fromMe) {
        anchorIndex = i;
        break;
      }
    }
  }

  const before = Math.max(0, maxContextMessages - 5);
  const start = Math.max(0, anchorIndex - before);
  const end = Math.min(enriched.length, anchorIndex + 6);
  const slice = enriched.slice(start, end);

  const transcriptLines = slice
    .map((msg) => messageLine(msg, includeOcrText))
    .filter(Boolean);

  const target = enriched[anchorIndex];
  const targetLine = target ? messageLine(target, includeOcrText) : null;
  const language = detectReplyLanguage(enriched, replyLanguage);
  const toneLabel = TONE_LABELS[tone] || TONE_LABELS.professional;

  const userParts = [
    `Chat: "${chatName}" (${platform}, ${chatType})`,
    `Tone: ${toneLabel}`,
    `Reply language: ${language}`,
  ];

  if (instruction?.trim()) {
    userParts.push(`User instruction: ${instruction.trim()}`);
  }

  userParts.push(
    '',
    '--- Transcript (oldest to newest) ---',
    transcriptLines.join('\n') || '(no text messages in context)',
    '',
    '--- Reply to this message ---',
    targetLine || '(latest message in thread)',
    '',
    `Provide exactly ${draftCount} distinct reply option(s). Prefix each with "OPTION 1:", "OPTION 2:", etc. on its own paragraph.`,
  );

  const promptText = userParts.join('\n');
  const tokenBudget = 12000;
  let trimmed = promptText;
  if (estimateTokens(SYSTEM_PROMPT) + estimateTokens(trimmed) > tokenBudget) {
    const lines = transcriptLines.slice(-20);
    trimmed = [
      ...userParts.slice(0, userParts.indexOf('--- Transcript (oldest to newest) ---') + 1),
      lines.join('\n'),
      ...userParts.slice(userParts.indexOf('--- Reply to this message ---')),
    ].join('\n');
  }

  return {
    system: SYSTEM_PROMPT,
    user: trimmed,
    targetMessageId: target?.id || null,
    anchorIndex,
    contextMessageCount: slice.length,
  };
}

export function parseReplyDrafts(rawText, draftCount = 3) {
  const text = String(rawText || '').trim();
  if (!text) return [];

  const optionRegex = /OPTION\s*(\d+)\s*:\s*/gi;
  const parts = [];
  let match;
  let lastIndex = 0;
  let lastNum = 0;

  while ((match = optionRegex.exec(text)) !== null) {
    if (lastNum > 0) {
      parts.push(text.slice(lastIndex, match.index).trim());
    }
    lastNum = Number(match[1]);
    lastIndex = match.index + match[0].length;
  }

  if (lastNum > 0) {
    parts.push(text.slice(lastIndex).trim());
  }

  const drafts = parts.filter(Boolean).slice(0, draftCount);
  if (drafts.length > 0) return drafts;

  const numbered = text
    .split(/\n(?=\d+[).\]]\s)/)
    .map((s) => s.replace(/^\d+[).\]]\s*/, '').trim())
    .filter(Boolean);

  if (numbered.length > 1) return numbered.slice(0, draftCount);

  return [text];
}
