import type { ProviderModelOverride } from '../schemas/provider-models'
import { defineProvider } from './types'

// ACCTOKEN (acctoken.com) — a Chinese relay that fronts DeepSeek / Qwen / GLM / Kimi / MiniMax behind one
// key. OpenAI-compatible at /v1 (chat + responses) and Anthropic Messages at the bare host.
//
// Registry mirror rather than the live `/v1/models`: the relay's live list mixes image, video, embedding
// and rerank rows in with the chat models, and the generic OpenAI mapper would surface all of them as
// chat models. These rows are the relay's chat catalog: the (provider → model) link plus the EXACT
// apiModelId the relay serves. Model definitions live in the creators (models.json). No per-model pricing
// is published here (the relay's own price list is per-account).
//
// Every mirrored model is reachable on all three endpoints the relay exposes, so each row pins them
// explicitly (the provider default alone would leave Responses / Anthropic unselectable per model).
const ACCTOKEN_ENDPOINTS = ['openai-chat-completions', 'openai-responses', 'anthropic-messages'] as const

const row = (modelId: string, apiModelId: string): Partial<ProviderModelOverride> => ({
  modelId,
  apiModelId,
  endpointTypes: [...ACCTOKEN_ENDPOINTS]
})

export default defineProvider({
  id: 'acctoken',
  name: 'ACCTOKEN',
  availableInEditions: ['cn', 'global'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://www.acctoken.com' },
    'openai-chat-completions': { adapterFamily: 'openai-compatible', baseUrl: 'https://www.acctoken.com/v1' },
    'openai-responses': { adapterFamily: 'openai', baseUrl: 'https://www.acctoken.com/v1' }
  },
  metadata: {
    website: {
      apiKey: 'https://www.acctoken.com/keys',
      docs: 'https://www.acctoken.com/about',
      models: 'https://www.acctoken.com/pricing',
      official: 'https://www.acctoken.com'
    }
  },
  modelListSource: 'registry',
  overrides: [
    // DeepSeek
    row('deepseek-v4-flash', 'deepseek-v4-flash'),
    row('deepseek-v4-1-flash', 'deepseek-v4.1-flash'),
    row('deepseek-v4-pro', 'deepseek-v4-pro'),
    // Qwen
    row('qwen3-8-flash', 'qwen3.8-flash'),
    row('qwen3-8-max', 'qwen3.8-max'),
    row('qwen3-7-flash', 'qwen3.7-flash'),
    row('qwen3-7-plus', 'qwen3.7-plus'),
    row('qwen3-7-max', 'qwen3.7-max'),
    row('qwen3-vl-plus', 'qwen3-vl-plus'),
    // GLM. glm-5.1 is deliberately not mirrored: it is toggle-only and the relay's upstream for it does
    // not accept the generic OpenAI-compatible toggle wire; users who still need it can add it by hand.
    row('glm-5-3', 'glm-5.3'),
    row('glm-5-3-flash', 'glm-5.3-flash'),
    {
      // Vendor-exclusive fast variant of GLM-5.3-Flash with no creator row; standalone metadata so the
      // app knows it reads images and can call tools.
      ...row('glm-5-3-flashx', 'glm-5.3-flashx'),
      name: 'GLM-5.3-FlashX',
      family: 'glm',
      ownedBy: 'zhipu',
      capabilities: { force: ['function-call', 'reasoning', 'image-recognition', 'structured-output'] },
      inputModalities: ['text', 'image'],
      outputModalities: ['text']
    },
    row('glm-5-2', 'glm-5.2'),
    // Kimi
    row('kimi-k3', 'kimi/kimi-k3'),
    row('kimi-k2-7-code', 'kimi-k2.7-code'),
    row('kimi-k2-6', 'kimi-k2.6'),
    // MiniMax
    row('minimax-m3', 'MiniMax-M3'),
    row('minimax-m2-5', 'MiniMax-M2.5')
  ]
})
