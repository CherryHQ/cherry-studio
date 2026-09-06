import { defineProvider } from './types'

const claudeWebToolModels = [
  'claude-opus-4',
  'claude-sonnet-4',
  'claude-haiku-4',
  'claude-3-5-haiku',
  'claude-3-5-sonnet',
  'claude-3-7-sonnet'
]
const geminiWebToolModels = [
  'gemini-2',
  'gemini-3',
  'gemini-flash-latest',
  'gemini-pro-latest',
  'gemini-flash-lite-latest'
]
const openAIWebSearchModels = ['gpt-4o', 'gpt-4-1', 'gpt-5', 'o3', 'o4']

/**
 * NO per-model overrides. An override is also a catalog row here, so it would advertise models to
 * every user regardless of what their relay actually serves. The thinking wire it used to carry
 * (`extra_body.thinking.type`) reached no upstream anyway: `extra_body` is OpenAI-SDK-side sugar,
 * and the correct field depends on the channel behind the model — New API's own answer to that is
 * server-side 参数覆盖, not a client guess.
 */
export default defineProvider({
  id: 'new-api',
  name: 'New API',
  authOptional: true,
  availableInEditions: ['global', 'cn'],
  // Self-hosted: only the default endpoint carries the placeholder host. A
  // baseUrl here would override the user's single host on every other endpoint.
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'newapi'
    },
    'openai-chat-completions': {
      adapterFamily: 'newapi',
      baseUrl: 'http://localhost:3000',
      reasoningFormat: { type: 'openai-chat' }
    },
    // `newapi` on every endpoint, so all four route through the NewAPI adapter and get the
    // per-route version segment. Left inferred, these two resolve to the plain `openai` / `google`
    // adapters, which read the host verbatim: `/responses` with no `/v1`, and `/v1/…:generateContent`
    // when the user typed `/v1`.
    'openai-responses': {
      adapterFamily: 'newapi'
    },
    'google-generate-content': {
      adapterFamily: 'newapi'
    }
  },
  // Gateway-mapped delivery (same vendor-segment fallback as cherryin): a
  // self-hosted New API can front any model, but only vendors owning a native
  // tool factory actually receive one.
  serverTools: [
    {
      id: 'web-search',
      modelScope: 'model-dependent',
      modelIdPrefixes: [...claudeWebToolModels, ...geminiWebToolModels, ...openAIWebSearchModels],
      imageModelIds: ['gemini-3-pro-image', 'gemini-3-pro-image-preview'],
      vendors: ['anthropic', 'gemini', 'openai']
    },
    {
      id: 'url-context',
      modelScope: 'model-dependent',
      modelIdPrefixes: [...claudeWebToolModels, ...geminiWebToolModels],
      vendors: ['anthropic', 'gemini']
    }
  ],
  metadata: {
    website: {
      docs: 'https://docs.newapi.pro',
      official: 'https://docs.newapi.pro/'
    }
  }
})
