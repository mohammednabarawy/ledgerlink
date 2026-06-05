import {
  DEMO_BACKGROUND_OCR,
  DEMO_DOWNLOADED_MODELS,
  DEMO_GLOBAL_SETTINGS,
  DEMO_LOCAL_CAPABILITIES,
  DEMO_PROFILE,
  DEMO_PROFILES,
  DEMO_REVIEW_MESSAGES,
  DEMO_SELECTED_TG_CHAT,
  DEMO_SELECTED_WA_CHAT,
  DEMO_TELEGRAM_ACCOUNT,
  DEMO_TELEGRAM_CHATS,
  DEMO_VAULT_PATH,
  DEMO_WHATSAPP_ACCOUNT,
  DEMO_WHATSAPP_CHATS,
} from './fixtures.js';

/** @returns {string | null} scene id from ?demo= */
export function getDemoScene() {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('demo');
}

export function isDemoMode() {
  return !!getDemoScene();
}

/**
 * Returns partial App state to apply for a screenshot scene.
 * All data is fictional — safe for public README assets.
 */
export function getDemoBootstrap(scene) {
  const base = {
    profiles: DEMO_PROFILES,
    activeProfile: DEMO_PROFILE,
    vaultPath: DEMO_VAULT_PATH,
    globalSettings: DEMO_GLOBAL_SETTINGS,
    downloadedModels: DEMO_DOWNLOADED_MODELS,
    localServiceCapabilities: DEMO_LOCAL_CAPABILITIES,
    settingsVaultPath: DEMO_VAULT_PATH,
    settingsOcrLanguage: 'eng+ara',
    settingsOcrThreshold: 65,
    settingsOcrAutoScan: true,
    settingsTelegramApiId: DEMO_GLOBAL_SETTINGS.telegram.apiId,
    settingsTelegramApiHash: DEMO_GLOBAL_SETTINGS.telegram.apiHash,
    watcherStatus: {
      globalEnabled: true,
      enabledChatIds: [DEMO_SELECTED_WA_CHAT.id],
      vaultPath: DEMO_VAULT_PATH,
    },
  };

  switch (scene) {
    case 'workspace':
      return {
        ...base,
        activePlatform: 'whatsapp',
        isAuthenticated: true,
        accountInfo: DEMO_WHATSAPP_ACCOUNT,
        chats: DEMO_WHATSAPP_CHATS,
        selectedChat: DEMO_SELECTED_WA_CHAT,
        archiveProgress: 100,
        archiveStatus: 'Archive complete — 24 messages, 3 attachments',
        lastResult: { messagesArchived: 24, attachments: 3 },
        backgroundOcrStatusMap: { [DEMO_SELECTED_WA_CHAT.id]: DEMO_BACKGROUND_OCR },
      };

    case 'review':
      return {
        ...base,
        activePlatform: 'whatsapp',
        isAuthenticated: true,
        accountInfo: DEMO_WHATSAPP_ACCOUNT,
        chats: DEMO_WHATSAPP_CHATS,
        selectedChat: DEMO_SELECTED_WA_CHAT,
        reviewOpen: true,
        reviewMessages: DEMO_REVIEW_MESSAGES,
        reviewLoading: false,
      };

    case 'telegram':
      return {
        ...base,
        activePlatform: 'telegram',
        isTGAuthenticated: true,
        tgStatus: { state: 'READY' },
        tgAccountInfo: DEMO_TELEGRAM_ACCOUNT,
        chats: DEMO_TELEGRAM_CHATS,
        selectedChat: DEMO_SELECTED_TG_CHAT,
        watcherStatus: {
          globalEnabled: true,
          enabledChatIds: [DEMO_SELECTED_TG_CHAT.id],
          vaultPath: DEMO_VAULT_PATH,
        },
        lastResult: { messagesArchived: 18, attachments: 1 },
        archiveProgress: 100,
        archiveStatus: 'Telegram archive complete',
      };

    case 'settings-ocr':
      return {
        ...base,
        activePlatform: 'whatsapp',
        isAuthenticated: true,
        accountInfo: DEMO_WHATSAPP_ACCOUNT,
        chats: DEMO_WHATSAPP_CHATS,
        selectedChat: DEMO_SELECTED_WA_CHAT,
        globalSettingsModalOpen: true,
        settingsTab: 'ocr',
      };

    case 'settings-transcription':
      return {
        ...base,
        activePlatform: 'whatsapp',
        isAuthenticated: true,
        accountInfo: DEMO_WHATSAPP_ACCOUNT,
        globalSettingsModalOpen: true,
        settingsTab: 'transcription',
      };

    case 'archive-progress':
      return {
        ...base,
        activePlatform: 'whatsapp',
        isAuthenticated: true,
        accountInfo: DEMO_WHATSAPP_ACCOUNT,
        chats: DEMO_WHATSAPP_CHATS,
        selectedChat: DEMO_SELECTED_WA_CHAT,
        isWorking: true,
        archiveProgress: 62,
        archiveStatus: 'Writing March 2026 messages to Obsidian…',
      };

    default:
      return null;
  }
}
