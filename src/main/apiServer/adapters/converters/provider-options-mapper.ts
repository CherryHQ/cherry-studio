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
import { ReasoningEffort } from '@cherrystudio/openai/resources'
import type { OpenRouterProviderOptions } from '@openrouter/ai-sdk-provider'
import { SystemProviderIds } from '@shared/types'
import { isAnthropicProvider, isAwsBedrockProvider, isGeminiProvider, isOpenAIProvider } from '@shared/utils/provider'
import type { Provider } from '@types'

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
        thinking: {
          type: config.type,
          budgetTokens: config.type === 'enabled' ? config.budget_tokens : undefined
        }
      } as AnthropicProviderOptions
    }
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

  // For other providers, thinking options are not automatically mapped
  return undefined
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
        thinking: {
          type: 'enabled',
          budgetTokens: budgetMap[reasoningEffort]
        }
      } as AnthropicProviderOptions
    }
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

  // For other providers, reasoning effort is not automatically mapped
  return undefined
}
