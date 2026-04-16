/**
 * 职责：提供原子化的、无状态的API调用函数
 */
import { dataApiService } from '@data/DataApiService'
import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import i18n from '@renderer/i18n'
import { hubMCPServer } from '@renderer/store/mcp'
import type { Assistant, MCPServer, MCPTool, Model, Provider } from '@renderer/types'
import { getEffectiveMcpMode, isSystemProvider } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { removeSpecialCharactersForTopicName } from '@renderer/utils'
import { getErrorMessage } from '@renderer/utils/error'
import { purifyMarkdownImages } from '@renderer/utils/markdown'
import { findFileBlocks, getMainTextContent } from '@renderer/utils/messageUtils/find'
import { containsSupportedVariables, replacePromptVariables } from '@renderer/utils/prompt'
import { NOT_SUPPORT_API_KEY_PROVIDER_TYPES, NOT_SUPPORT_API_KEY_PROVIDERS } from '@renderer/utils/provider'
import { createUniqueModelId } from '@shared/data/types/model'
import { isEmpty, takeRight } from 'lodash'

import { getDefaultAssistant, getDefaultModel, getQuickModel } from './AssistantService'

const logger = loggerService.withContext('ApiService')

/**
 * Fetch active MCP servers from the Data API.
 */
async function fetchActiveMcpServers(): Promise<MCPServer[]> {
  const response = await dataApiService.get('/mcp-servers', { query: { isActive: true } })
  return (response as { items: MCPServer[] }).items ?? []
}

/**
 * Get the MCP servers to use based on the assistant's MCP mode.
 */
export async function getMcpServersForAssistant(assistant: Assistant): Promise<MCPServer[]> {
  const mode = getEffectiveMcpMode(assistant)

  switch (mode) {
    case 'disabled':
      return []
    case 'auto':
      return [hubMCPServer]
    case 'manual': {
      const activedMcpServers = await fetchActiveMcpServers()
      const assistantMcpServers = assistant.mcpServers || []
      return activedMcpServers.filter((server) => assistantMcpServers.some((s) => s.id === server.id))
    }
    default:
      return []
  }
}

export async function fetchAllActiveServerTools(): Promise<MCPTool[]> {
  const activedMcpServers = await fetchActiveMcpServers()

  if (activedMcpServers.length === 0) {
    return []
  }

  try {
    const toolPromises = activedMcpServers.map(async (mcpServer: MCPServer) => {
      try {
        const tools = await window.api.mcp.listTools(mcpServer)
        return tools.filter((tool: any) => !mcpServer.disabledTools?.includes(tool.name))
      } catch (error) {
        logger.error(`Error fetching tools from MCP server ${mcpServer.name}:`, error as Error)
        return []
      }
    })
    const results = await Promise.allSettled(toolPromises)
    return results
      .filter((result): result is PromiseFulfilledResult<MCPTool[]> => result.status === 'fulfilled')
      .map((result) => result.value)
      .flat()
  } catch (toolError) {
    logger.error('Error fetching all active server tools:', toolError as Error)
    return []
  }
}

export async function fetchMessagesSummary({
  messages
}: {
  messages: Message[]
}): Promise<{ text: string | null; error?: string }> {
  let prompt = (await preferenceService.get('topic.naming_prompt')) || i18n.t('prompts.title')
  const model = getQuickModel()

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

export async function fetchNoteSummary({ content, assistant }: { content: string; assistant?: Assistant }) {
  let prompt = (await preferenceService.get('topic.naming_prompt')) || i18n.t('prompts.title')
  const resolvedAssistant = assistant || getDefaultAssistant()
  const model = getQuickModel() || resolvedAssistant.model || getDefaultModel()

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
    const resolvedModel = model || getDefaultModel()
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
      error: error as Error
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
