/** Fictional demo data for README screenshots — no real users or chats. */

const NOW = Math.floor(Date.now() / 1000);

export const DEMO_VAULT_PATH = 'C:\\Users\\Documents\\Obsidian\\LedgerVault';

export const DEMO_PROFILE = {
  id: 'demo-finance',
  name: 'Finance Desk',
  icon: 'briefcase',
  color: '#10b981',
  vaultPath: DEMO_VAULT_PATH,
  ocr: { language: 'eng+ara', confidenceThreshold: 65, autoScan: true },
};

export const DEMO_PROFILES = [
  DEMO_PROFILE,
  { id: 'demo-personal', name: 'Personal', icon: 'user', color: '#3b82f6', vaultPath: null },
];

export const DEMO_WHATSAPP_ACCOUNT = {
  pushname: 'Alex Morgan',
  profilePicUrl: null,
  id: 'demo-wa-user@c.us',
};

export const DEMO_TELEGRAM_ACCOUNT = {
  pushname: 'Alex Morgan',
  profilePicUrl: null,
  id: 'demo-tg-user',
};

export const DEMO_WHATSAPP_CHATS = [
  {
    id: 'demo-wa-chat-1@c.us',
    name: 'Accounts Payable Team',
    isGroup: true,
    typeLabel: 'Group',
    timestamp: NOW - 3600,
    unreadCount: 3,
  },
  {
    id: 'demo-wa-chat-2@c.us',
    name: 'Client Invoices — Q2',
    isGroup: true,
    typeLabel: 'Group',
    timestamp: NOW - 86400,
    unreadCount: 0,
  },
  {
    id: 'demo-wa-chat-3@c.us',
    name: 'Treasury & Finance',
    isGroup: true,
    typeLabel: 'Group',
    timestamp: NOW - 172800,
    unreadCount: 0,
  },
  {
    id: 'demo-wa-chat-4@c.us',
    name: 'Northwind Supplies',
    isGroup: false,
    typeLabel: 'Contact',
    timestamp: NOW - 259200,
    unreadCount: 1,
  },
  {
    id: 'demo-wa-chat-5@c.us',
    name: 'Tax Documents Archive',
    isGroup: false,
    typeLabel: 'Contact',
    timestamp: NOW - 604800,
    unreadCount: 0,
  },
];

export const DEMO_TELEGRAM_CHATS = [
  {
    id: 'tg:demo-channel-1',
    name: 'Ledger Updates Channel',
    isGroup: true,
    typeLabel: 'Channel',
    timestamp: NOW - 7200,
    unreadCount: 0,
  },
  {
    id: 'tg:demo-group-1',
    name: 'Audit Working Group',
    isGroup: true,
    typeLabel: 'Group',
    timestamp: NOW - 43200,
    unreadCount: 2,
  },
  {
    id: 'tg:demo-contact-1',
    name: 'Finance Coordinator',
    isGroup: false,
    typeLabel: 'Contact',
    timestamp: NOW - 86400,
    unreadCount: 0,
  },
];

export const DEMO_SELECTED_WA_CHAT = DEMO_WHATSAPP_CHATS[0];
export const DEMO_SELECTED_TG_CHAT = DEMO_TELEGRAM_CHATS[0];

export const DEMO_REVIEW_MESSAGES = [
  {
    id: 'demo-msg-1',
    senderName: 'Sarah Chen',
    displayTime: '10:42 AM',
    fromMe: false,
    body: 'Please archive the March receipt images when you get a chance.',
    hasMedia: false,
    type: 'chat',
  },
  {
    id: 'demo-msg-2',
    senderName: 'Me',
    displayTime: '10:45 AM',
    fromMe: true,
    body: 'On it — running OCR on the supplier invoices now.',
    hasMedia: false,
    type: 'chat',
  },
  {
    id: 'demo-msg-3',
    senderName: 'Northwind Supplies',
    displayTime: '10:48 AM',
    fromMe: false,
    body: '',
    hasMedia: true,
    type: 'image',
  },
  {
    id: 'demo-msg-4',
    senderName: 'Me',
    displayTime: '10:52 AM',
    fromMe: true,
    body: 'Archived 24 messages and 3 attachments to Obsidian.',
    hasMedia: false,
    type: 'chat',
  },
];

export const DEMO_GLOBAL_SETTINGS = {
  transcription: { modelSize: 'tiny' },
  telegram: { apiId: '28471936', apiHash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6' },
};

export const DEMO_DOWNLOADED_MODELS = {
  tiny: true,
  base: false,
  small: false,
  medium: false,
  large: false,
};

export const DEMO_LOCAL_CAPABILITIES = {
  documentOcr: {
    pdf: { available: true, reason: null },
    word: { available: false, reason: 'Word document OCR has been deprecated.' },
  },
  transcription: {
    hardware: { gpuNames: ['NVIDIA GeForce RTX 4060'], hasNvidia: true },
    engines: [{ id: 'whisper.cpp', label: 'whisper.cpp', available: true }],
  },
};

export const DEMO_BACKGROUND_OCR = {
  status: 'idle',
  progress: 68,
  done: 17,
  total: 25,
  failed: 0,
  documentPending: 2,
  documentDone: 5,
  transcriptionPending: 1,
  current: 'invoice_march_014.jpg',
};
