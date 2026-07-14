import type { Provider } from '@shared/data/types/provider'
import { SystemProviderIds } from '@shared/utils/systemProviderId'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Control which provider-family branch is taken per test.
vi.mock('@shared/utils/provider', () => ({
  isAnthropicProvider: vi.fn(() => false),
  isGeminiProvider: vi.fn(() => false),
  isOpenAIProvider: vi.fn(() => false),
  isAwsBedrockProvider: vi.fn(() => false)
}))

import { isAnthropicProvider, isAwsBedrockProvider, isGeminiProvider, isOpenAIProvider } from '@shared/utils/provider'

import {
  mapAnthropicThinkingToProviderOptions,
  mapGeminiThinkingToProviderOptions,
  mapReasoningEffortToProviderOptions
} from '../converters/providerOptionsMapper'

const provider = (id = 'p'): Provider => ({ id }) as Provider
const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

beforeEach(() => {
  // mockReturnValue persists across tests; reset every guard to false each time.
  asMock(isAnthropicProvider).mockReturnValue(false)
  asMock(isGeminiProvider).mockReturnValue(false)
  asMock(isOpenAIProvider).mockReturnValue(false)
  asMock(isAwsBedrockProvider).mockReturnValue(false)
})

describe('mapAnthropicThinkingToProviderOptions', () => {
  it('returns undefined when there is no thinking config', () => {
    expect(mapAnthropicThinkingToProviderOptions(provider(), undefined)).toBeUndefined()
  })

  it('maps to Anthropic thinking (budget only when enabled)', () => {
    asMock(isAnthropicProvider).mockReturnValue(true)
    expect(mapAnthropicThinkingToProviderOptions(provider(), { type: 'enabled', budget_tokens: 1024 })).toEqual({
      anthropic: { thinking: { type: 'enabled', budgetTokens: 1024 } }
    })
    expect(mapAnthropicThinkingToProviderOptions(provider(), { type: 'disabled' })).toEqual({
      anthropic: { thinking: { type: 'disabled', budgetTokens: undefined } }
    })
  })

  it('maps to Gemini thinkingConfig', () => {
    asMock(isGeminiProvider).mockReturnValue(true)
    expect(mapAnthropicThinkingToProviderOptions(provider(), { type: 'enabled', budget_tokens: 512 })).toEqual({
      google: { thinkingConfig: { thinkingBudget: 512, includeThoughts: true } }
    })
  })

  it('maps to OpenAI reasoningEffort', () => {
    asMock(isOpenAIProvider).mockReturnValue(true)
    expect(mapAnthropicThinkingToProviderOptions(provider(), { type: 'enabled', budget_tokens: 1 })).toEqual({
      openai: { reasoningEffort: 'high' }
    })
  })

  it('maps to OpenRouter / xAI by provider id', () => {
    expect(
      mapAnthropicThinkingToProviderOptions(provider(SystemProviderIds.openrouter), {
        type: 'enabled',
        budget_tokens: 1
      })
    ).toEqual({ openrouter: { reasoning: { enabled: true, effort: 'high' } } })
    expect(
      mapAnthropicThinkingToProviderOptions(provider(SystemProviderIds.grok), { type: 'enabled', budget_tokens: 1 })
    ).toEqual({ xai: { reasoningEffort: 'high' } })
  })

  it('maps to Bedrock reasoningConfig', () => {
    asMock(isAwsBedrockProvider).mockReturnValue(true)
    expect(mapAnthropicThinkingToProviderOptions(provider(), { type: 'enabled', budget_tokens: 800 })).toEqual({
      bedrock: { reasoningConfig: { type: 'enabled', budgetTokens: 800 } }
    })
  })

  it('returns undefined for an unsupported provider', () => {
    expect(
      mapAnthropicThinkingToProviderOptions(provider('mystery'), { type: 'enabled', budget_tokens: 1 })
    ).toBeUndefined()
  })
})

describe('mapReasoningEffortToProviderOptions', () => {
  it('returns undefined when there is no reasoning effort', () => {
    expect(mapReasoningEffortToProviderOptions(provider(), undefined)).toBeUndefined()
  })

  it('maps effort to Anthropic thinking budget (low/medium/high)', () => {
    asMock(isAnthropicProvider).mockReturnValue(true)
    expect(mapReasoningEffortToProviderOptions(provider(), 'low')).toEqual({
      anthropic: { thinking: { type: 'enabled', budgetTokens: 5000 } }
    })
    expect(mapReasoningEffortToProviderOptions(provider(), 'high')).toEqual({
      anthropic: { thinking: { type: 'enabled', budgetTokens: 20000 } }
    })
  })

  it('maps OpenAI effort, downgrading low → none', () => {
    asMock(isOpenAIProvider).mockReturnValue(true)
    expect(mapReasoningEffortToProviderOptions(provider(), 'low')).toEqual({ openai: { reasoningEffort: 'none' } })
    expect(mapReasoningEffortToProviderOptions(provider(), 'medium')).toEqual({ openai: { reasoningEffort: 'medium' } })
  })

  it('maps OpenRouter / xAI by provider id (xAI drops low)', () => {
    expect(mapReasoningEffortToProviderOptions(provider(SystemProviderIds.openrouter), 'medium')).toEqual({
      openrouter: { reasoning: { enabled: true, effort: 'medium' } }
    })
    expect(mapReasoningEffortToProviderOptions(provider(SystemProviderIds.grok), 'low')).toEqual({
      xai: { reasoningEffort: undefined }
    })
  })

  it('returns undefined for an unsupported provider', () => {
    expect(mapReasoningEffortToProviderOptions(provider('mystery'), 'high')).toBeUndefined()
  })
})

describe('mapGeminiThinkingToProviderOptions', () => {
  // A Gemini/Google target must keep the native sentinel semantics verbatim — the old
  // round trip through the Anthropic shape inverted them (-1 → 0, 0 → -1) and dropped
  // thinkingLevel. Each case pins the exact byte the Gemini upstream should receive.
  describe('Gemini/Google target (native, lossless)', () => {
    beforeEach(() => asMock(isGeminiProvider).mockReturnValue(true))

    it('passes a dynamic budget (-1) through unchanged (was inverted to 0)', () => {
      expect(mapGeminiThinkingToProviderOptions(provider(), { thinkingBudget: -1 })).toEqual({
        google: { thinkingConfig: { thinkingBudget: -1 } }
      })
    })

    it('passes a disabled budget (0) through unchanged (was inverted to -1)', () => {
      expect(mapGeminiThinkingToProviderOptions(provider(), { thinkingBudget: 0 })).toEqual({
        google: { thinkingConfig: { thinkingBudget: 0 } }
      })
    })

    it('keeps includeThoughts without a budget (no bogus budget 0 injected)', () => {
      expect(mapGeminiThinkingToProviderOptions(provider(), { includeThoughts: true })).toEqual({
        google: { thinkingConfig: { includeThoughts: true } }
      })
    })

    it('preserves the Gemini 3 thinkingLevel (previously dropped)', () => {
      expect(mapGeminiThinkingToProviderOptions(provider(), { thinkingLevel: 'high' })).toEqual({
        google: { thinkingConfig: { thinkingLevel: 'high' } }
      })
    })

    it('forwards a positive fixed budget with includeThoughts', () => {
      expect(mapGeminiThinkingToProviderOptions(provider(), { thinkingBudget: 512, includeThoughts: true })).toEqual({
        google: { thinkingConfig: { thinkingBudget: 512, includeThoughts: true } }
      })
    })

    it('returns undefined for an empty thinkingConfig', () => {
      expect(mapGeminiThinkingToProviderOptions(provider(), {})).toBeUndefined()
    })
  })

  describe('non-Gemini target (translate without inverting)', () => {
    beforeEach(() => asMock(isOpenAIProvider).mockReturnValue(true))

    it('treats a dynamic budget (-1) as enabled', () => {
      expect(mapGeminiThinkingToProviderOptions(provider(), { thinkingBudget: -1 })).toEqual({
        openai: { reasoningEffort: 'high' }
      })
    })

    it('treats a zero budget as disabled', () => {
      expect(mapGeminiThinkingToProviderOptions(provider(), { thinkingBudget: 0 })).toEqual({
        openai: { reasoningEffort: 'none' }
      })
    })

    it('treats includeThoughts-only as enabled', () => {
      expect(mapGeminiThinkingToProviderOptions(provider(), { includeThoughts: true })).toEqual({
        openai: { reasoningEffort: 'high' }
      })
    })

    it('treats a thinkingLevel-only config (no budget) as enabled', () => {
      expect(mapGeminiThinkingToProviderOptions(provider(), { thinkingLevel: 'high' })).toEqual({
        openai: { reasoningEffort: 'high' }
      })
    })
  })
})
