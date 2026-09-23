import type { ReasoningSupport } from '../schemas/model'
import type { ReasoningWireProfile } from '../schemas/reasoningWire'
import { defineProvider } from './types'
import { EFFORT, modeWire } from './wires'

const usd = (perMillionTokens: number) => ({ currency: 'USD' as const, perMillionTokens })
const price = (input: number, output: number) => ({ input: usd(input), output: usd(output) })

/**
 * One accepted field, three behaviours — so each family gets its own contract
 * and unknown models stay fail-closed on the provider default.
 *
 * Measured against the host, mean `reasoning_content` chars over three runs:
 *
 *              absent   low   medium   high
 *   gpt-oss       365    283     469    1289   graded
 *   DeepSeek V4     0    845     785     747   presence is the switch
 *   Kimi          990   1242    1542    1392   no caller control
 */

/** Graded, and cannot be turned off: reasoning runs with the field absent. */
const gptOssSupport: ReasoningSupport = {
  controls: [{ kind: 'effort', values: ['low', 'medium', 'high'], default: 'medium' }],
  defaultEffort: 'medium'
}
const gptOssWire: ReasoningWireProfile = modeWire('reasoning_effort', { effort: EFFORT })

/**
 * A toggle whose "off" is the absence of the field. The value is not read, so
 * `auto` sends the host's own default rather than inventing a level, and no
 * `off` mode is declared — emitting `reasoning_effort: 'none'` would switch
 * reasoning ON here, which is what the inherited openai-chat profile does.
 */
const deepSeekSupport: ReasoningSupport = { controls: [{ kind: 'toggle' }] }
const deepSeekWire: ReasoningWireProfile = modeWire('reasoning_effort', { auto: 'high', effort: EFFORT })

/** Always reasons; nothing the caller sends changes it. */
const kimiSupport: ReasoningSupport = { controls: [] }
const kimiWire: ReasoningWireProfile = { disabled: true }

const contract = (support: ReasoningSupport, wire: ReasoningWireProfile) => ({
  'openai-chat-completions': { support, wire }
})

export default defineProvider({
  id: 'gitgot',
  name: 'GitGot',
  availableInEditions: ['global'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://inference.gitgot.ai/v1',
      // Fail closed. The generic openai-chat profile turns "off" into
      // `reasoning_effort: 'none'`, which this host either rejects or reads as
      // a request to reason. Every served model states its contract below.
      reasoningFormat: { type: 'openai-chat', wire: { disabled: true } }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://gitgot.ai/dashboard',
      docs: 'https://gitgot.ai/docs/quickstart',
      models: 'https://inference.gitgot.ai/v1/models',
      official: 'https://gitgot.ai'
    }
  },
  // Limits and prices are this host's, not the base model's: the fleet serves
  // shorter contexts than the weights allow, and a catalog default would quote
  // both wrongly. Checked against https://inference.gitgot.ai/v1/models.
  overrides: [
    {
      modelId: 'gpt-oss-120b',
      apiModelId: 'openai/gpt-oss-120b',
      limits: { contextWindow: 131_072, maxOutputTokens: 32_768 },
      pricing: price(0.03626, 0.1666),
      reasoningContracts: contract(gptOssSupport, gptOssWire)
    },
    {
      modelId: 'kimi-k2-7-code',
      apiModelId: 'moonshotai/Kimi-K2.7-Code',
      limits: { contextWindow: 262_144, maxOutputTokens: 64_000 },
      pricing: price(0.6664, 3.332),
      reasoningContracts: contract(kimiSupport, kimiWire)
    },
    {
      modelId: 'kimi-k2-6',
      apiModelId: 'moonshotai/Kimi-K2.6',
      limits: { contextWindow: 262_144, maxOutputTokens: 64_000 },
      pricing: price(0.735, 3.43),
      reasoningContracts: contract(kimiSupport, kimiWire)
    },
    {
      modelId: 'deepseek-v4-pro',
      apiModelId: 'deepseek-ai/DeepSeek-V4-Pro',
      limits: { contextWindow: 163_840, maxOutputTokens: 32_768 },
      pricing: price(1.274, 2.548),
      reasoningContracts: contract(deepSeekSupport, deepSeekWire)
    },
    {
      modelId: 'deepseek-v4-flash',
      apiModelId: 'deepseek-ai/DeepSeek-V4-Flash',
      limits: { contextWindow: 163_840, maxOutputTokens: 32_768 },
      pricing: price(0.0882, 0.1764),
      reasoningContracts: contract(deepSeekSupport, deepSeekWire)
    },
    {
      modelId: 'llama-3-3-70b-instruct',
      apiModelId: 'meta-llama/Llama-3.3-70B-Instruct',
      limits: { contextWindow: 131_072, maxOutputTokens: 32_768 },
      pricing: price(0.1323, 0.392)
    }
  ]
})
