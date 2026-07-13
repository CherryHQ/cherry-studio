/**
 * Provider Options Mapper
 *
 * Maps input format-specific thinking/reasoning configuration to
 * AI SDK provider-specific options.
 *
 * TODO: Refactor this module:
 * 1. Move shared reasoning config from src/renderer/src/config/models/reasoning.ts to @shared
 * 2. Reuse MODEL_SUPPORTED_REASONING_EFFORT for budgetMap instead of hardcoding
 * 3. For unsupported providers, pass through reasoning params in OpenAI-compatible format
 *    instead of returning undefined (all requests should transparently forward reasoning config)
 * 4. Both Anthropic and OpenAI converters should handle OpenAI-compatible mapping
 */

import type { BedrockProviderOptions } from '@ai-sdk/amazon-bedrock'
import type { AnthropicProviderOptions } from '@ai-sdk/anthropic'
import type { GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { XaiProviderOptions } from '@ai-sdk/xai'
import type { MessageCreateParams } from '@anthropic-ai/sdk/resources/messages'
import type { ReasoningEffort } from '@cherrystudio/openai/resources'

// Re-export for use by message converters
export type { ReasoningEffort }
import type { OpenRouterProviderOptions } from '@openrouter/ai-sdk-provider'
import type { Provider } from '@shared/data/types/provider'
import { isAnthropicProvider, isAwsBedrockProvider, isGeminiProvider, isOpenAIProvider } from '@shared/utils/provider'
import { SystemProviderIds } from '@shared/utils/systemProviderId'

/**
 * Map Anthropic thinking configuration to AI SDK provider options
 *
 * Converts Anthropic's thinking.type and budget_tokens to provider-specific
 * parameters for various AI providers.
 */
export function mapAnthropicThinkingToProviderOptions(
  provider: Provider,
  config: MessageCreateParams['thinking']
): ProviderOptions | undefined {
  if (!config) return undefined

  // Anthropic provider
  if (isAnthropicProvider(provider)) {
    return {
      anthropic: {
        // Type only the `thinking` field this mapper owns: `satisfies Pick<…, 'thinking'>` keeps
        // full type checking without coupling to AnthropicProviderOptions' unrelated `fallbacks`
        // field, whose non-JSON type would otherwise break the ProviderOptions (JSONObject) value.
        thinking:
          config.type === 'enabled' ? { type: 'enabled', budgetTokens: config.budget_tokens } : { type: config.type }
      } satisfies Pick<AnthropicProviderOptions, 'thinking'>
    } satisfies ProviderOptions
  }

  // Google/Gemini provider
  if (isGeminiProvider(provider)) {
    return {
      google: {
        thinkingConfig: {
          thinkingBudget: config.type === 'enabled' ? config.budget_tokens : -1,
          includeThoughts: config.type === 'enabled'
        }
      } as GoogleGenerativeAIProviderOptions
    }
  }

  // OpenAI provider (Responses API)
  if (isOpenAIProvider(provider)) {
    return {
      openai: {
        reasoningEffort: config.type === 'enabled' ? 'high' : 'none'
      } as OpenAIResponsesProviderOptions
    }
  }

  // OpenRouter provider
  if (provider.id === SystemProviderIds.openrouter) {
    return {
      openrouter: {
        reasoning: {
          enabled: config.type === 'enabled',
          effort: 'high'
        }
      } as OpenRouterProviderOptions
    }
  }

  // XAI/Grok provider
  if (provider.id === SystemProviderIds.grok) {
    return {
      xai: {
        reasoningEffort: config.type === 'enabled' ? 'high' : undefined
      } as XaiProviderOptions
    }
  }

  // AWS Bedrock provider
  if (isAwsBedrockProvider(provider)) {
    return {
      bedrock: {
        reasoningConfig: {
          type: config.type,
          budgetTokens: config.type === 'enabled' ? config.budget_tokens : undefined
        }
      } as BedrockProviderOptions
    }
  }

  // TODO: For other providers, pass through in OpenAI-compatible format
  // instead of returning undefined. All requests should transparently forward reasoning config.
  return undefined
}

/**
 * Map a Gemini-native `thinkingConfig` to AI SDK provider options.
 *
 * Gemini's `thinkingBudget` is a sentinel — `-1` = dynamic, `0` = disabled, `> 0` =
 * fixed budget — and Gemini 3 adds `thinkingLevel`. Routing this through the Anthropic
 * thinking shape (binary enabled/disabled + a non-negative budget) INVERTS the
 * sentinels (`-1` → `0`, `0` → `-1`) and drops `thinkingLevel`. So for a Gemini/Google
 * target we forward the native config verbatim (lossless); for any other provider we
 * translate the sentinels into the shared thinking shape WITHOUT inverting them, then
 * reuse the generic per-provider mapper.
 */
export function mapGeminiThinkingToProviderOptions(
  provider: Provider,
  thinkingConfig: { includeThoughts?: boolean; thinkingBudget?: number; thinkingLevel?: string }
): ProviderOptions | undefined {
  const { includeThoughts, thinkingBudget, thinkingLevel } = thinkingConfig

  if (isGeminiProvider(provider)) {
    const nativeThinkingConfig: { thinkingBudget?: number; includeThoughts?: boolean; thinkingLevel?: string } = {}
    if (typeof thinkingBudget === 'number') nativeThinkingConfig.thinkingBudget = thinkingBudget
    if (typeof includeThoughts === 'boolean') nativeThinkingConfig.includeThoughts = includeThoughts
    if (typeof thinkingLevel === 'string') nativeThinkingConfig.thinkingLevel = thinkingLevel
    if (Object.keys(nativeThinkingConfig).length === 0) return undefined
    return { google: { thinkingConfig: nativeThinkingConfig } as GoogleGenerativeAIProviderOptions }
  }

  // budget 0 (or no thinking signal) → disabled; budget > 0 → that fixed budget;
  // budget < 0 (dynamic) / a thinkingLevel / includeThoughts → enabled (no exact fixed
  // budget on non-Gemini providers, so 0 lets the generic mapper pick effort/dynamic).
  const enabled =
    thinkingBudget === undefined ? includeThoughts === true || typeof thinkingLevel === 'string' : thinkingBudget !== 0
  const thinking: MessageCreateParams['thinking'] = enabled
    ? { type: 'enabled', budget_tokens: typeof thinkingBudget === 'number' && thinkingBudget > 0 ? thinkingBudget : 0 }
    : { type: 'disabled' }
  return mapAnthropicThinkingToProviderOptions(provider, thinking)
}

/**
 * Map OpenAI-style reasoning_effort to AI SDK provider options
 *
 * Converts reasoning_effort (low/medium/high) to provider-specific
 * thinking/reasoning parameters.
 */
export function mapReasoningEffortToProviderOptions(
  provider: Provider,
  reasoningEffort?: ReasoningEffort
): ProviderOptions | undefined {
  if (!reasoningEffort) return undefined

  // TODO: Import from @shared/config/reasoning instead of hardcoding
  // Should reuse MODEL_SUPPORTED_REASONING_EFFORT from reasoning.ts
  const budgetMap = { low: 5000, medium: 10000, high: 20000 }

  // Anthropic: Map to thinking.budgetTokens
  if (isAnthropicProvider(provider)) {
    return {
      anthropic: {
        thinking: { type: 'enabled', budgetTokens: budgetMap[reasoningEffort] }
      } satisfies Pick<AnthropicProviderOptions, 'thinking'>
    } satisfies ProviderOptions
  }

  // Google/Gemini: Map to thinkingConfig.thinkingBudget
  if (isGeminiProvider(provider)) {
    return {
      google: {
        thinkingConfig: {
          thinkingBudget: budgetMap[reasoningEffort],
          includeThoughts: true
        }
      } as GoogleGenerativeAIProviderOptions
    }
  }

  // OpenAI: Use reasoningEffort directly
  if (isOpenAIProvider(provider)) {
    return {
      openai: {
        reasoningEffort: reasoningEffort === 'low' ? 'none' : reasoningEffort
      } as OpenAIResponsesProviderOptions
    }
  }

  // OpenRouter: Map to reasoning.effort
  if (provider.id === SystemProviderIds.openrouter) {
    return {
      openrouter: {
        reasoning: {
          enabled: true,
          effort: reasoningEffort
        }
      } as OpenRouterProviderOptions
    }
  }

  // XAI/Grok: Map to reasoningEffort
  if (provider.id === SystemProviderIds.grok) {
    return {
      xai: {
        reasoningEffort: reasoningEffort === 'low' ? undefined : reasoningEffort
      } as XaiProviderOptions
    }
  }

  // AWS Bedrock: Map to reasoningConfig
  if (isAwsBedrockProvider(provider)) {
    return {
      bedrock: {
        reasoningConfig: {
          type: 'enabled',
          budgetTokens: budgetMap[reasoningEffort]
        }
      } as BedrockProviderOptions
    }
  }

  // TODO: For other providers, pass through in OpenAI-compatible format
  // instead of returning undefined. All requests should transparently forward reasoning config.
  return undefined
}
