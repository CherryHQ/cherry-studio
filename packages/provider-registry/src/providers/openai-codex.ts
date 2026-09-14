import type { ReasoningEffort } from '../schemas/enums'
import type { ProviderModelOverride } from '../schemas/provider-models'
import { defineProvider } from './types'
import { openaiResponsesSummaryWire } from './wires'

/**
 * The Codex backend publishes its own per-model ladder in upstream
 * `codex-rs/models-manager/models.json` — it differs from the platform API
 * (no `none`, plus the subscription-only `ultra` tier on some SKUs).
 */
function codexReasoning(
  values: readonly ReasoningEffort[],
  defaultEffort: ReasoningEffort
): ProviderModelOverride['reasoningContracts'] {
  return {
    'openai-responses': {
      support: { controls: [{ kind: 'effort', values: [...values], default: defaultEffort }], defaultEffort }
    }
  }
}

/**
 * Login-based provider that drives the ChatGPT Plus/Pro Codex backend via an
 * app-managed OAuth session (`authMethods: ['oauth']`); model list served from
 * this registry (`modelListSource: 'registry'`). OAuth runtime lives in
 * `src/main/services/oauth/`.
 */
export default defineProvider({
  id: 'openai-codex',
  name: 'OpenAI Codex',
  availableInEditions: ['global'],
  defaultChatEndpoint: 'openai-responses',
  modelListSource: 'registry',
  authMethods: ['oauth'],
  fastMode: { transport: 'openai-priority' },
  endpointConfigs: {
    'openai-responses': {
      adapterFamily: 'openai',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      reasoningFormat: { type: 'openai-responses', wire: openaiResponsesSummaryWire }
    }
  },
  metadata: {
    website: {
      official: 'https://openai.com/codex',
      docs: 'https://platform.openai.com/docs/codex'
    }
  },
  overrides: [
    {
      modelId: 'gpt-6-astra',
      apiModelId: 'gpt-6-astra',
      supportsFastMode: true,
      limits: { contextWindow: 272000, maxInputTokens: 144000 },
      endpointTypes: ['openai-responses'],
      reasoningContracts: codexReasoning(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], 'low')
    },
    // Codex backend serves the gpt-5.6 family with a 372k context window
    // (per upstream `codex-rs/models-manager/models.json`), smaller than the
    // platform-API figure the base catalog carries.
    {
      modelId: 'gpt-5-6-sol',
      apiModelId: 'gpt-5.6-sol',
      supportsFastMode: true,
      limits: { contextWindow: 372000 },
      endpointTypes: ['openai-responses'],
      reasoningContracts: codexReasoning(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], 'low')
    },
    {
      modelId: 'gpt-5-6-terra',
      apiModelId: 'gpt-5.6-terra',
      supportsFastMode: true,
      limits: { contextWindow: 372000 },
      endpointTypes: ['openai-responses'],
      reasoningContracts: codexReasoning(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], 'medium')
    },
    {
      modelId: 'gpt-5-6-luna',
      apiModelId: 'gpt-5.6-luna',
      supportsFastMode: true,
      limits: { contextWindow: 372000 },
      endpointTypes: ['openai-responses'],
      reasoningContracts: codexReasoning(['low', 'medium', 'high', 'xhigh', 'max'], 'medium')
    },
    {
      modelId: 'gpt-5-5',
      apiModelId: 'gpt-5.5',
      supportsFastMode: true,
      endpointTypes: ['openai-responses'],
      reasoningContracts: codexReasoning(['low', 'medium', 'high', 'xhigh'], 'medium')
    },
    {
      modelId: 'gpt-5-4',
      apiModelId: 'gpt-5.4',
      supportsFastMode: true,
      endpointTypes: ['openai-responses'],
      reasoningContracts: codexReasoning(['low', 'medium', 'high', 'xhigh'], 'medium')
    },
    {
      modelId: 'gpt-5-4-mini',
      apiModelId: 'gpt-5.4-mini',
      endpointTypes: ['openai-responses'],
      reasoningContracts: codexReasoning(['low', 'medium', 'high', 'xhigh'], 'medium')
    },
    { modelId: 'gpt-5-3-codex-spark', apiModelId: 'gpt-5.3-codex-spark', endpointTypes: ['openai-responses'] }
  ]
})
