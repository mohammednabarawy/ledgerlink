/**
 * AI assistant provider presets and settings resolution.
 * Credentials stay in global app settings (userData), never in the renderer.
 */

export const ASSISTANT_PROVIDERS = {
  ollama: {
    id: 'ollama',
    label: 'Ollama (local)',
    defaultBaseUrl: 'http://127.0.0.1:11434',
    apiStyle: 'ollama',
    defaultModel: 'llama3.2:3b',
    requiresApiKey: false,
    privacy: 'local',
  },
  lmstudio: {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    defaultBaseUrl: 'http://127.0.0.1:1234/v1',
    apiStyle: 'openai',
    defaultModel: '',
    requiresApiKey: false,
    privacy: 'local',
  },
  opencode: {
    id: 'opencode',
    label: 'OpenCode Zen (free models)',
    defaultBaseUrl: 'https://opencode.ai/zen/v1',
    apiStyle: 'openai',
    defaultModel: 'mimo-v2.5-free',
    requiresApiKey: true,
    authScheme: 'bearer',
    privacy: 'cloud',
    suggestedModels: [
      'mimo-v2.5-free',
      'nemotron-3-ultra-free',
      'deepseek-v4-flash-free',
      'big-pickle',
      'minimax-m2.5-free',
    ],
  },
  'openai-compatible': {
    id: 'openai-compatible',
    label: 'OpenAI-compatible API',
    defaultBaseUrl: 'https://api.openai.com/v1',
    apiStyle: 'openai',
    defaultModel: 'gpt-4o-mini',
    requiresApiKey: true,
    authScheme: 'bearer',
    privacy: 'cloud',
  },
};

export const DEFAULT_ASSISTANT_SETTINGS = {
  enabled: false,
  provider: 'ollama',
  baseUrl: '',
  model: 'llama3.2:3b',
  apiKey: '',
  defaultTone: 'professional',
  replyLanguage: 'auto',
  maxContextMessages: 40,
  includeOcrText: true,
  temperature: 0.7,
  draftCount: 3,
};

let settingsProvider = null;

export function setAssistantSettingsProvider(provider) {
  settingsProvider = provider;
}

export function getAssistantSettings() {
  const raw = settingsProvider?.() || {};
  return {
    ...DEFAULT_ASSISTANT_SETTINGS,
    ...raw,
  };
}

export function resolveProviderConfig(settings = getAssistantSettings()) {
  const preset = ASSISTANT_PROVIDERS[settings.provider] || ASSISTANT_PROVIDERS.ollama;
  const baseUrl = (settings.baseUrl || '').trim() || preset.defaultBaseUrl;
  const model = (settings.model || '').trim() || preset.defaultModel;
  return {
    ...preset,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    model,
    apiKey: (settings.apiKey || '').trim(),
    temperature: Number(settings.temperature) || 0.7,
    draftCount: Math.min(5, Math.max(1, Number(settings.draftCount) || 3)),
    defaultTone: settings.defaultTone || 'professional',
    replyLanguage: settings.replyLanguage || 'auto',
    maxContextMessages: Number(settings.maxContextMessages) || 40,
    includeOcrText: settings.includeOcrText !== false,
    enabled: settings.enabled !== false,
  };
}

export function validateAssistantConfig(config = resolveProviderConfig()) {
  if (!config.model) {
    return { ok: false, error: 'Model name is required.' };
  }
  if (config.requiresApiKey && !config.apiKey) {
    return { ok: false, error: 'API key is required for this provider.' };
  }
  return { ok: true };
}
