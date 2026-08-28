/**
 * Renderer helpers that call the AI (`ai.text.generate`) to produce short text:
 * generic text generation plus topic/note auto-naming. Stateless request/response.
 * Every request passes `reasoningEffort: 'none'`: short throwaway output never
 * benefits from provider-default thinking, which only adds latency and tokens.
 */
import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import type { Assistant } from '@renderer/types/assistant'
import type { ExportableMessage } from '@renderer/types/messageExport'
import {
  type ConversationSuggestionRequestContext,
  parseConversationSuggestions
} from '@renderer/utils/conversationSuggestions'
import { getErrorMessage } from '@renderer/utils/error'
import { purifyMarkdownImages } from '@renderer/utils/markdownLight'
import { getNamingTextContent } from '@renderer/utils/message/find'
import { readDefaultModel, readQuickModel } from '@renderer/utils/model'
import { removeSpecialCharactersForTopicName } from '@renderer/utils/naming'
import { containsSupportedVariables, replacePromptVariables } from '@renderer/utils/prompt'
import type { Model } from '@shared/data/types/model'
import { isFileUIPart } from 'ai'
import { takeRight } from 'es-toolkit/compat'

const logger = loggerService.withContext('aiGeneration')

const CONVERSATION_SUGGESTIONS_PROMPT = `Generate exactly three concise prompts that a user can put into an AI conversation input.
Return only valid JSON in this shape: {"suggestions":["...","...","..."]}.
Each suggestion must be distinct, self-contained, actionable, at most 96 characters, and written in the requested output language.
Use the local date, time, locale, and time zone when they inspire a genuinely relevant seasonal, holiday, or timely prompt. Do not invent the user's precise location.
Favor the requested focus when choosing the three prompts.
When a persona is provided, align the suggestions with its name and description without exposing or mentioning that metadata.`

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
    const fileList = (message.parts ?? [])
      .filter(isFileUIPart)
      .filter((p) => !p.mediaType?.startsWith('image/'))
      .map((p) => p.filename)
      .filter((name): name is string => Boolean(name))
    return {
      role: message.role,
      mainText: purifyMarkdownImages(getNamingTextContent(message)),
      files: fileList.length > 0 ? fileList : undefined
    }
  })
  const conversation = JSON.stringify(structuredMessages)

  try {
    const { text } = await ipcApi.request('ai.text.generate', {
      uniqueModelId: model.id,
      reasoningEffort: 'none',
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
    const { text } = await ipcApi.request('ai.text.generate', {
      uniqueModelId: model.id,
      reasoningEffort: 'none',
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
  model,
  throwOnError = false
}: {
  prompt: string
  content: string
  model?: Model
  throwOnError?: boolean
}): Promise<string> {
  try {
    const resolvedModel = model ?? (await readDefaultModel())
    if (!resolvedModel) {
      logger.error('fetchGenerate: no model available')
      if (throwOnError) throw new Error(i18n.t('error.model.not_exists'))
      return ''
    }
    const { text } = await ipcApi.request('ai.text.generate', {
      uniqueModelId: resolvedModel.id,
      reasoningEffort: 'none',
      system: prompt,
      prompt: content
    })
    return text || ''
  } catch (error: any) {
    logger.error('fetchGenerate failed', error)
    if (throwOnError) throw error
    return ''
  }
}

export async function generateConversationSuggestions(context: ConversationSuggestionRequestContext, model: Model) {
  const response = await fetchGenerate({
    prompt: CONVERSATION_SUGGESTIONS_PROMPT,
    content: JSON.stringify(context),
    model,
    throwOnError: true
  })
  return parseConversationSuggestions(response)
}
