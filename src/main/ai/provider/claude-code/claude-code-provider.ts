/**
 * Claude Code provider factory.
 *
 * Creates LanguageModelV3 instances backed by the Claude Agent SDK.
 * Settings are merged: provider defaults + per-model overrides.
 */

import type { LanguageModelV3, ProviderV3 } from '@ai-sdk/provider'
import { NoSuchModelError } from '@ai-sdk/provider'

import { ClaudeCodeLanguageModel, type ClaudeCodeModelId } from './claude-code-language-model'
import { withDeepSeek1mSuffix } from './deepseekContext'
import type { ClaudeCodeProviderSettings, ClaudeCodeSettings } from './types'

/**
 * Claude Code provider interface extending AI SDK's ProviderV3.
 */
export interface ClaudeCodeProvider extends ProviderV3 {
  (modelId: ClaudeCodeModelId, settings?: ClaudeCodeSettings): LanguageModelV3
  languageModel(modelId: ClaudeCodeModelId, settings?: ClaudeCodeSettings): LanguageModelV3
  chat(modelId: ClaudeCodeModelId, settings?: ClaudeCodeSettings): LanguageModelV3
  imageModel(modelId: string): never
}

/**
 * Creates a Claude Code provider instance with the specified configuration.
 */
export function createClaudeCode(options: ClaudeCodeProviderSettings = {}): ClaudeCodeProvider {
  const createModel = (modelId: ClaudeCodeModelId, settings: ClaudeCodeSettings = {}): LanguageModelV3 => {
    const mergedSettings: ClaudeCodeSettings = {
      ...options.defaultSettings,
      ...settings,
      // Inject apiKey/baseURL into env — standard AI SDK provider pattern
      env: {
        ...options.defaultSettings?.env,
        ...settings.env,
        ...(options.apiKey ? { ANTHROPIC_API_KEY: options.apiKey, ANTHROPIC_AUTH_TOKEN: options.apiKey } : {}),
        ...(options.baseURL ? { ANTHROPIC_BASE_URL: options.baseURL } : {})
      }
    }
    // DeepSeek V4+ pro on the official host: append `[1m]` so Claude Code
    // budgets a 1M context window (suffix is parsed then stripped by the SDK). #14965
    const sdkModelId = withDeepSeek1mSuffix(modelId, options.baseURL) as ClaudeCodeModelId
    return new ClaudeCodeLanguageModel({ id: sdkModelId, settings: mergedSettings })
  }

  const provider = function (modelId: ClaudeCodeModelId, settings?: ClaudeCodeSettings) {
    if (new.target) {
      throw new Error('The Claude Code model function cannot be called with the new keyword.')
    }
    return createModel(modelId, settings)
  }

  provider.languageModel = createModel
  provider.chat = createModel
  provider.specificationVersion = 'v3' as const

  provider.embeddingModel = (modelId: string) => {
    throw new NoSuchModelError({ modelId, modelType: 'embeddingModel' })
  }

  provider.imageModel = (modelId: string) => {
    throw new NoSuchModelError({ modelId, modelType: 'imageModel' })
  }

  return provider as ClaudeCodeProvider
}
