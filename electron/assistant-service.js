import {
  getAssistantSettings,
  resolveProviderConfig,
  validateAssistantConfig,
  ASSISTANT_PROVIDERS,
} from './assistant-config.js';
import { buildReplyPrompt, parseReplyDrafts } from './assistant-context.js';

function buildAuthHeaders(config) {
  const headers = { 'Content-Type': 'application/json' };
  if (!config.apiKey) return headers;

  if (config.authScheme === 'x-api-key') {
    headers['x-api-key'] = config.apiKey;
  } else {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }
  return headers;
}

async function readErrorBody(res) {
  try {
    const data = await res.json();
    return data?.error?.message || data?.message || JSON.stringify(data);
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
}

function parseOpenAIStreamChunk(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return null;
  const payload = trimmed.slice(5).trim();
  if (payload === '[DONE]') return { done: true };
  try {
    const json = JSON.parse(payload);
    const content = json?.choices?.[0]?.delta?.content;
    if (content) return { content };
    if (json?.choices?.[0]?.finish_reason) return { done: true };
  } catch {
    return null;
  }
  return null;
}

function parseOllamaStreamChunk(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const json = JSON.parse(trimmed);
    const content = json?.message?.content;
    if (content) return { content };
    if (json?.done) return { done: true };
  } catch {
    return null;
  }
  return null;
}

async function streamCompletion({ config, messages, onProgress }) {
  const headers = buildAuthHeaders(config);
  let url;
  let body;

  if (config.apiStyle === 'ollama') {
    url = `${config.baseUrl}/api/chat`;
    body = {
      model: config.model,
      stream: true,
      messages,
      options: { temperature: config.temperature },
    };
  } else {
    url = `${config.baseUrl}/chat/completions`;
    body = {
      model: config.model,
      stream: true,
      temperature: config.temperature,
      messages,
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(await readErrorBody(res));
  }

  if (!res.body) {
    const data = await res.json();
    if (config.apiStyle === 'ollama') {
      return data?.message?.content || '';
    }
    return data?.choices?.[0]?.message?.content || '';
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const chunk = config.apiStyle === 'ollama'
        ? parseOllamaStreamChunk(line)
        : parseOpenAIStreamChunk(line);

      if (!chunk) continue;
      if (chunk.content) {
        fullText += chunk.content;
        onProgress?.({ phase: 'streaming', text: fullText });
      }
    }
  }

  return fullText;
}

export class AssistantService {
  constructor(onProgress) {
    this.onProgress = onProgress;
  }

  getProviders() {
    return ASSISTANT_PROVIDERS;
  }

  async listModels(providerId) {
    const settings = getAssistantSettings();
    const config = resolveProviderConfig({ ...settings, provider: providerId || settings.provider });
    const preset = ASSISTANT_PROVIDERS[config.id || settings.provider] || ASSISTANT_PROVIDERS.ollama;

    if (preset.suggestedModels?.length) {
      return { models: preset.suggestedModels.map((id) => ({ id, name: id })) };
    }

    try {
      if (config.apiStyle === 'ollama') {
        const res = await fetch(`${config.baseUrl}/api/tags`);
        if (!res.ok) throw new Error(await readErrorBody(res));
        const data = await res.json();
        const models = (data?.models || []).map((m) => ({
          id: m.name || m.model,
          name: m.name || m.model,
        }));
        return { models };
      }

      const res = await fetch(`${config.baseUrl}/models`, {
        headers: buildAuthHeaders(config),
      });
      if (!res.ok) throw new Error(await readErrorBody(res));
      const data = await res.json();
      const models = (data?.data || []).map((m) => ({
        id: m.id,
        name: m.id,
      }));
      return { models };
    } catch (err) {
      return { models: [], error: err.message || String(err) };
    }
  }

  async testConnection(overrides = {}) {
    const settings = { ...getAssistantSettings(), ...overrides };
    const config = resolveProviderConfig(settings);
    const validation = validateAssistantConfig(config);
    if (!validation.ok) return validation;

    try {
      const listed = await this.listModels(config.id);
      if (listed.error && !listed.models?.length) {
        return { ok: false, error: listed.error };
      }
      return {
        ok: true,
        provider: config.id,
        model: config.model,
        models: listed.models?.slice(0, 20) || [],
        privacy: config.privacy,
      };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  async suggestReply(payload = {}) {
    const settings = getAssistantSettings();
    if (!settings.enabled) {
      throw new Error('AI assistant is disabled. Enable it in App Settings → Assistant.');
    }

    const config = resolveProviderConfig(settings);
    const validation = validateAssistantConfig(config);
    if (!validation.ok) throw new Error(validation.error);

    const {
      chatName,
      platform,
      chatType,
      messages = [],
      targetMessageId,
      tone,
      instruction,
      ocrEnrichment = {},
    } = payload;

    const prompt = buildReplyPrompt({
      chatName,
      platform,
      chatType,
      messages,
      targetMessageId,
      tone: tone || config.defaultTone,
      instruction,
      replyLanguage: settings.replyLanguage,
      maxContextMessages: config.maxContextMessages,
      includeOcrText: config.includeOcrText,
      draftCount: config.draftCount,
      ocrEnrichment,
    });

    this.onProgress?.({ phase: 'start', contextMessageCount: prompt.contextMessageCount });

    const llmMessages = [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ];

    const rawText = await streamCompletion({
      config,
      messages: llmMessages,
      onProgress: (data) => this.onProgress?.(data),
    });

    const drafts = parseReplyDrafts(rawText, config.draftCount);
    this.onProgress?.({ phase: 'complete', drafts });

    return {
      drafts,
      rawText,
      targetMessageId: prompt.targetMessageId,
      contextMessageCount: prompt.contextMessageCount,
      provider: config.id,
      model: config.model,
    };
  }
}
