/**
 * 职责：提供原子化的、无状态的API调用函数
 */
import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import i18n from '@renderer/i18n'
import type { Assistant, Model, Provider } from '@renderer/types'
import { isSystemProvider } from '@renderer/types'
import type { ExportableMessage } from '@renderer/types/messageExport'
import { removeSpecialCharactersForTopicName } from '@renderer/utils'
import { getErrorMessage } from '@renderer/utils/error'
import { purifyMarkdownImages } from '@renderer/utils/markdown'
import { findFileBlocks, getMainTextContent } from '@renderer/utils/messageUtils/find'
import { containsSupportedVariables, replacePromptVariables } from '@renderer/utils/prompt'
import { NOT_SUPPORT_API_KEY_PROVIDER_TYPES, NOT_SUPPORT_API_KEY_PROVIDERS } from '@renderer/utils/provider'
import { createUniqueModelId } from '@shared/data/types/model'
import { isEmpty, takeRight } from 'lodash'

import { readDefaultModel, readQuickModel } from './ModelService'

const logger = loggerService.withContext('ApiService')

export async function fetchMessagesSummary({
  messages
}: {
  messages: ExportableMessage[]
}): Promise<{ text: string | null; error?: string }> {
  let prompt = (await preferenceService.get('topic.naming_prompt')) || i18n.t('prompts.title')
  const model = await readQuickModel()
  if (!model) {
    return { text: null, error: i18n.t('error.model.not_exists') }
  }

  if (prompt && containsSupportedVariables(prompt)) {
    prompt = await replacePromptVariables(prompt, model.name)
  }

  // 取最后5条消息，结构化为 JSON
  const contextMessages = takeRight(messages, 5)
  const structuredMessages = contextMessages.map((message) => {
    const fileBlocks = findFileBlocks(message)
    const fileList = fileBlocks.map((b) => b.file.origin_name).filter(Boolean)
    return {
      role: message.role,
      mainText: purifyMarkdownImages(getMainTextContent(message)),
      files: fileList.length > 0 ? fileList : undefined
    }
  })
  const conversation = JSON.stringify(structuredMessages)

  try {
    const { text } = await window.api.ai.generateText({
      uniqueModelId: createUniqueModelId(model.provider, model.id),
      system: prompt,
      prompt: conversation
    })

    const result = removeSpecialCharactersForTopicName(text)
    return result ? { text: result } : { text: null, error: i18n.t('error.no_response') }
  } catch (error: unknown) {
    return { text: null, error: getErrorMessage(error) }
  }
}

export async function fetchNoteSummary({ content }: { content: string; assistant?: Assistant }) {
  let prompt = (await preferenceService.get('topic.naming_prompt')) || i18n.t('prompts.title')
  // Note summarisation always uses the quick-assistant model. The optional
  // assistant parameter was a v1 escape hatch (read assistant.model); in v2 the
  // assistant has no embedded model, so we go straight to the user's quick
  // model preference.
  const model = (await readQuickModel()) ?? (await readDefaultModel())
  if (!model) return null

  if (prompt && containsSupportedVariables(prompt)) {
    prompt = await replacePromptVariables(prompt, model.name)
  }

  // only 2000 chars, no images
  const purifiedContent = purifyMarkdownImages(content.substring(0, 2000))

  try {
    const { text } = await window.api.ai.generateText({
      uniqueModelId: createUniqueModelId(model.provider, model.id),
      system: prompt,
      prompt: purifiedContent
    })
    return removeSpecialCharactersForTopicName(text) || null
  } catch (error: any) {
    return null
  }
}

export async function fetchGenerate({
  prompt,
  content,
  model
}: {
  prompt: string
  content: string
  model?: Model
}): Promise<string> {
  try {
    const resolvedModel = model ?? (await readDefaultModel())
    if (!resolvedModel) {
      logger.error('fetchGenerate: no model available')
      return ''
    }
    const { text } = await window.api.ai.generateText({
      uniqueModelId: createUniqueModelId(resolvedModel.provider, resolvedModel.id),
      system: prompt,
      prompt: content
    })
    return text || ''
  } catch (error: any) {
    logger.error('fetchGenerate failed', error)
    return ''
  }
}

export async function fetchModels(provider: Provider): Promise<Model[]> {
  try {
    return await window.api.ai.listModels({ providerId: provider.id })
  } catch (error) {
    logger.error('Failed to fetch models from provider', {
      providerId: provider.id,
      providerName: provider.name,
      error: error instanceof Error ? error.message : String(error)
    })
    return []
  }
}

export function checkApiProvider(provider: Provider): void {
  const isExcludedProvider =
    (isSystemProvider(provider) && NOT_SUPPORT_API_KEY_PROVIDERS.includes(provider.id)) ||
    NOT_SUPPORT_API_KEY_PROVIDER_TYPES.includes(provider.type)

  if (!isExcludedProvider) {
    if (!provider.apiKey) {
      window.toast.error(i18n.t('message.error.enter.api.label'))
      throw new Error(i18n.t('message.error.enter.api.label'))
    }
  }

  if (!provider.apiHost && provider.type !== 'vertexai') {
    window.toast.error(i18n.t('message.error.enter.api.host'))
    throw new Error(i18n.t('message.error.enter.api.host'))
  }

  if (isEmpty(provider.models)) {
    window.toast.error(i18n.t('message.error.enter.model'))
    throw new Error(i18n.t('message.error.enter.model'))
  }
}

/**
 * Validates that a provider/model pair is working by sending a minimal probe.
 *
 * Renderer responsibilities are limited to UI-side preflight (toast on missing
 * api key / host / models) and IPC forwarding. Probe dispatch (embedding vs
 * chat), timeout handling, and latency measurement all happen in Main.
 */
export async function checkApi(provider: Provider, model: Model, timeout = 15000): Promise<{ latency: number }> {
  checkApiProvider(provider)
  return await window.api.ai.checkModel({
    uniqueModelId: createUniqueModelId(provider.id, model.id),
    timeout
  })
}
