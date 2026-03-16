import { isOpenAIChatCompletionOnlyModel } from '@renderer/config/models'
import { type Model, type Provider, SystemProviderIds } from '@renderer/types'

import { getAiSdkProviderId } from './factory'

export interface AiSdkTransport {
  providerId: string
  mode?: 'responses' | 'chat'
}

/**
 * 解析当前请求实际要走的 AI SDK 传输配置。
 *
 * 注意这里返回的是传输层信息，不是业务层的 provider 语义：
 * - `providerId` 表示底层复用哪个 AI SDK provider
 * - `mode` 表示该 provider 走 `chat` 还是 `responses`
 */
export function resolveAiSdkTransport(actualProvider: Provider, model: Model): AiSdkTransport {
  const providerId = getAiSdkProviderId(actualProvider)

  // Poe 当前提供统一的 /responses 入口，因此这里有意让所有 Poe 模型
  // 暂时统一复用 OpenAI Responses transport。
  // 如果后续确认某些 Poe 模型在 /responses 下存在兼容性问题，再根据
  // 实际观测到的错误模式补模型级例外或回退逻辑。
  if (actualProvider.id === SystemProviderIds.poe) {
    return { providerId, mode: 'responses' }
  }

  // About mode of azure:
  // https://learn.microsoft.com/en-us/azure/ai-foundry/openai/latest
  // https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/responses?tabs=python-key#responses-api
  if (
    (actualProvider.type === 'openai-response' && !isOpenAIChatCompletionOnlyModel(model)) ||
    providerId === 'azure-responses'
  ) {
    return {
      providerId,
      mode: 'responses'
    }
  }

  if (
    providerId === 'openai' ||
    (providerId === 'cherryin' && actualProvider.type === 'openai') ||
    providerId === 'azure'
  ) {
    return {
      providerId,
      mode: 'chat'
    }
  }

  return { providerId }
}
