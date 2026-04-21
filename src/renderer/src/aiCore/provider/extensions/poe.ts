import { type AnthropicProvider, createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai'
import { NoSuchModelError, type ProviderV3 } from '@ai-sdk/provider'
import { type PoeProvider } from 'ai-sdk-provider-poe'

/**
 * Poe 与其他 provider 不同：
 * 1. `ai-sdk-provider-poe` 只暴露 language model，无法直接满足 Cherry 这里要求的 `ProviderV3` 形状。
 * 2. Poe 的 web search 实际取决于下游模型家族，需要在这里分发到 Anthropic/OpenAI/OpenAI Chat 的 tool descriptor。
 * 所以 Poe 需要单独一层 adapter，而不是像其他 provider 一样直接把 SDK provider 暴露给 extension。
 */

type PoeUnsupportedModelType = 'embeddingModel' | 'imageModel'
type PoeAnthropicWebSearchConfig = NonNullable<Parameters<AnthropicProvider['tools']['webSearch_20250305']>[0]>
type PoeOpenAIWebSearchConfig = NonNullable<Parameters<OpenAIProvider['tools']['webSearch']>[0]>
type PoeOpenAIChatWebSearchConfig = NonNullable<Parameters<OpenAIProvider['tools']['webSearchPreview']>[0]>
type PoeWebSearchConfig =
  | {
      downstreamProviderId: 'anthropic'
      anthropic?: PoeAnthropicWebSearchConfig
    }
  | {
      downstreamProviderId: 'openai'
      openai?: PoeOpenAIWebSearchConfig
    }
  | {
      downstreamProviderId: 'openai-chat'
      'openai-chat'?: PoeOpenAIChatWebSearchConfig
    }

const poeAnthropicToolProvider = createAnthropic({ apiKey: '_tool_descriptor' })
const poeOpenAIToolProvider = createOpenAI({ apiKey: '_tool_descriptor' })

function createUnsupportedPoeModelError(modelId: string, modelType: PoeUnsupportedModelType) {
  return new NoSuchModelError({
    modelId,
    modelType,
    message: `Poe provider does not support ${modelType} "${modelId}".`
  })
}

export function getPoeWebSearchPatch(config: PoeWebSearchConfig) {
  switch (config.downstreamProviderId) {
    case 'anthropic':
      return {
        tools: {
          webSearch: poeAnthropicToolProvider.tools.webSearch_20250305(config.anthropic ?? {})
        }
      }
    case 'openai-chat':
      return {
        tools: {
          webSearch: poeOpenAIToolProvider.tools.webSearchPreview(config['openai-chat'] ?? {})
        }
      }
    case 'openai':
    default:
      return {
        tools: {
          webSearch: poeOpenAIToolProvider.tools.webSearch(config.openai ?? {})
        }
      }
  }
}

export function adaptPoeProvider(provider: PoeProvider): ProviderV3 {
  return {
    specificationVersion: 'v3',
    languageModel: (modelId: string) => provider.languageModel(modelId),
    embeddingModel: (modelId: string) => {
      throw createUnsupportedPoeModelError(modelId, 'embeddingModel')
    },
    imageModel: (modelId: string) => {
      throw createUnsupportedPoeModelError(modelId, 'imageModel')
    }
  }
}
