import { loggerService } from '@logger'
import { LanguagesEnum } from '@renderer/config/translate'
import type { LegacyMessage as OldMessage, Topic, TranslateLanguageCode } from '@renderer/types'
import { FileTypes, WebSearchSource } from '@renderer/types' // Import FileTypes enum
import type {
  BaseMessageBlock,
  CitationMessageBlock,
  Message as NewMessage,
  MessageBlock
} from '@renderer/types/newMessage'
import { AssistantMessageStatus, MessageBlockStatus } from '@renderer/types/newMessage'
import { Transaction } from 'dexie'
import { isEmpty } from 'lodash'

import {
  createCitationBlock,
  createErrorBlock,
  createFileBlock,
  createImageBlock,
  createMainTextBlock,
  createThinkingBlock,
  createToolBlock,
  createTranslationBlock
} from '../utils/messageUtils/create'

const logger = loggerService.withContext('Database:Upgrades')

export async function upgradeToV5(tx: Transaction): Promise<void> {
  const topics = await tx.table('topics').toArray()
  const files = await tx.table('files').toArray()

  for (const file of files) {
    if (file.created_at instanceof Date) {
      file.created_at = file.created_at.toISOString()
      await tx.table('files').put(file)
    }
  }

  for (const topic of topics) {
    let hasChanges = false

    for (const message of topic.messages) {
      if (message?.metadata?.tavily) {
        hasChanges = true
        const tavily = message.metadata.tavily
        delete message.metadata.tavily
        message.metadata.webSearch = {
          query: tavily.query,
          results:
            tavily.results?.map((i) => ({
              title: i.title,
              url: i.url,
              content: i.content
            })) || []
        }
      }
    }

    if (hasChanges) {
      await tx.table('topics').put(topic)
    }
  }
}

// --- Simplified status mapping functions ---
function mapOldStatusToBlockStatus(oldStatus: OldMessage['status']): MessageBlockStatus {
  // Handle statuses that need mapping
  if (oldStatus === 'sending' || oldStatus === 'pending' || oldStatus === 'searching') {
    return MessageBlockStatus.PROCESSING
  }
  // For success, paused, error, the values match MessageBlockStatus
  if (oldStatus === 'success' || oldStatus === 'paused' || oldStatus === 'error') {
    // Cast is safe here as the values are identical
    return oldStatus as MessageBlockStatus
  }
  // Default fallback for any unexpected old status
  return MessageBlockStatus.PROCESSING
}

function mapOldStatusToNewMessageStatus(oldStatus: OldMessage['status']): NewMessage['status'] {
  // Handle statuses that need mapping
  if (oldStatus === 'pending' || oldStatus === 'sending') {
    return AssistantMessageStatus.PENDING
  }
  // For sending, success, paused, error, the values match NewMessage['status']
  if (oldStatus === 'searching' || oldStatus === 'success' || oldStatus === 'paused' || oldStatus === 'error') {
    // Cast is safe here as the values are identical
    return oldStatus as NewMessage['status']
  }
  // Default fallback
  return AssistantMessageStatus.PROCESSING
}

// --- UPDATED UPGRADE FUNCTION for Version 7 ---
export async function upgradeToV7(tx: Transaction): Promise<void> {
  logger.info('Starting DB migration to version 7: Normalizing messages and blocks...')

  const oldTopicsTable = tx.table('topics')
  const newBlocksTable = tx.table('message_blocks')
  const topicUpdates: Record<string, { messages: NewMessage[] }> = {}

  await oldTopicsTable.toCollection().each(async (oldTopic: Pick<Topic, 'id'> & { messages: OldMessage[] }) => {
    const newMessagesForTopic: NewMessage[] = []
    const blocksToCreate: MessageBlock[] = []

    if (!oldTopic.messages || !Array.isArray(oldTopic.messages)) {
      logger.warn(`Topic ${oldTopic.id} has no valid messages array, skipping.`)
      topicUpdates[oldTopic.id] = { messages: [] }
      return
    }

    for (const oldMessage of oldTopic.messages) {
      const messageBlockIds: string[] = []
      const citationDataToCreate: Partial<Omit<CitationMessageBlock, keyof BaseMessageBlock | 'type'>> = {}
      let hasCitationData = false

      // 2. Thinking Block (Status is SUCCESS)
      // 挪到前面,尽量保持与旧版本的一致性
      if (oldMessage.reasoning_content?.trim()) {
        const block = createThinkingBlock(oldMessage.id, oldMessage.reasoning_content, {
          createdAt: oldMessage.createdAt,
          thinking_millsec: oldMessage?.metrics?.time_thinking_millsec,
          status: MessageBlockStatus.SUCCESS // Thinking block is complete content
        })
        blocksToCreate.push(block)
        messageBlockIds.push(block.id)
      }

      // 7. Tool Blocks (Status based on original mcpTool status)
      // 挪到前面,尽量保持与旧版本的一致性
      if (oldMessage.metadata?.mcpTools?.length) {
        oldMessage.metadata.mcpTools.forEach((mcpTool) => {
          const block = createToolBlock(oldMessage.id, mcpTool.id, {
            // Determine status based on original tool status
            status: MessageBlockStatus.SUCCESS,
            content: mcpTool.response,
            error:
              mcpTool.status !== 'done'
                ? { message: 'MCP Tool did not complete', originalStatus: mcpTool.status }
                : undefined,
            createdAt: oldMessage.createdAt,
            metadata: { rawMcpToolResponse: mcpTool }
          })
          blocksToCreate.push(block)
          messageBlockIds.push(block.id)
        })
      }

      // 1. Main Text Block
      if (oldMessage.content?.trim()) {
        const block = createMainTextBlock(oldMessage.id, oldMessage.content, {
          createdAt: oldMessage.createdAt,
          status: mapOldStatusToBlockStatus(oldMessage.status),
          knowledgeBaseIds: oldMessage.knowledgeBaseIds
        })
        blocksToCreate.push(block)
        messageBlockIds.push(block.id)
      }

      // 3. Translation Block (Status is SUCCESS)
      if (oldMessage.translatedContent?.trim()) {
        const block = createTranslationBlock(oldMessage.id, oldMessage.translatedContent, 'unknown', {
          createdAt: oldMessage.createdAt,
          status: MessageBlockStatus.SUCCESS // Translation block is complete content
        })
        blocksToCreate.push(block)
        messageBlockIds.push(block.id)
      }

      // 4. File Blocks (Non-Image) and Image Blocks (from Files) (Status is SUCCESS)
      if (oldMessage.files?.length) {
        oldMessage.files.forEach((file) => {
          if (file.type === FileTypes.IMAGE) {
            const block = createImageBlock(oldMessage.id, {
              file: file,
              createdAt: oldMessage.createdAt,
              status: MessageBlockStatus.SUCCESS
            })
            blocksToCreate.push(block)
            messageBlockIds.push(block.id)
          } else {
            const block = createFileBlock(oldMessage.id, file, {
              createdAt: oldMessage.createdAt,
              status: MessageBlockStatus.SUCCESS
            })
            blocksToCreate.push(block)
            messageBlockIds.push(block.id)
          }
        })
      }

      // 5. Image Blocks (from Metadata - AI Generated) (Status is SUCCESS)
      if (oldMessage.metadata?.generateImage) {
        const block = createImageBlock(oldMessage.id, {
          metadata: { generateImageResponse: oldMessage.metadata.generateImage },
          createdAt: oldMessage.createdAt,
          status: MessageBlockStatus.SUCCESS
        })
        blocksToCreate.push(block)
        messageBlockIds.push(block.id)
      }

      // 6. Web Search Block - REMOVED, data moved to citation collection
      // if (oldMessage.metadata?.webSearch?.results?.length) { ... }

      // 8. Collect Citation and Reference Data (Simplified: Independent checks)
      if (oldMessage.metadata?.groundingMetadata) {
        hasCitationData = true
        citationDataToCreate.response = {
          results: oldMessage.metadata.groundingMetadata,
          source: WebSearchSource.GEMINI
        }
      }
      if (oldMessage.metadata?.annotations?.length) {
        hasCitationData = true
        citationDataToCreate.response = {
          results: oldMessage.metadata.annotations,
          source: WebSearchSource.OPENAI_RESPONSE
        }
      }
      if (oldMessage.metadata?.citations?.length) {
        hasCitationData = true
        citationDataToCreate.response = {
          results: oldMessage.metadata.citations,
          // 无法区分，统一为Openrouter
          source: WebSearchSource.OPENROUTER
        }
      }
      if (oldMessage.metadata?.webSearch) {
        hasCitationData = true
        citationDataToCreate.response = {
          results: oldMessage.metadata.webSearch,
          source: WebSearchSource.WEBSEARCH
        }
      }
      if (oldMessage.metadata?.webSearchInfo) {
        hasCitationData = true
        citationDataToCreate.response = {
          results: oldMessage.metadata.webSearchInfo,
          // 无法区分，统一为zhipu
          source: WebSearchSource.ZHIPU
        }
      }
      if (oldMessage.metadata?.knowledge?.length) {
        hasCitationData = true
        citationDataToCreate.knowledge = oldMessage.metadata.knowledge
      }

      // 9. Create Citation Block (if any citation data was found, no need to set citationType)
      if (hasCitationData) {
        const block = createCitationBlock(
          oldMessage.id,
          citationDataToCreate as Omit<CitationMessageBlock, keyof BaseMessageBlock | 'type'>,
          {
            createdAt: oldMessage.createdAt,
            status: MessageBlockStatus.SUCCESS
          }
        )
        blocksToCreate.push(block)
        messageBlockIds.push(block.id)
      }

      // 10. Error Block (Status is ERROR)
      if (oldMessage.error && typeof oldMessage.error === 'object' && Object.keys(oldMessage.error).length > 0) {
        if (isEmpty(oldMessage.content)) {
          const block = createErrorBlock(oldMessage.id, oldMessage.error, {
            createdAt: oldMessage.createdAt,
            status: MessageBlockStatus.ERROR // Error block status is ERROR
          })
          blocksToCreate.push(block)
          messageBlockIds.push(block.id)
        }
      }

      // 11. Create the New Message reference object (Add usage/metrics assignment)
      const newMessageReference: NewMessage = {
        id: oldMessage.id,
        role: oldMessage.role as NewMessage['role'],
        assistantId: oldMessage.assistantId || '',
        topicId: oldTopic.id,
        createdAt: oldMessage.createdAt,
        status: mapOldStatusToNewMessageStatus(oldMessage.status),
        modelId: oldMessage.modelId,
        model: oldMessage.model,
        type: oldMessage.type === 'clear' ? 'clear' : undefined,
        useful: oldMessage.useful,
        askId: oldMessage.askId,
        mentions: oldMessage.mentions,
        enabledMCPs: oldMessage.enabledMCPs,
        usage: oldMessage.usage,
        metrics: oldMessage.metrics,
        multiModelMessageStyle: oldMessage.multiModelMessageStyle,
        foldSelected: oldMessage.foldSelected,
        blocks: messageBlockIds
      }
      newMessagesForTopic.push(newMessageReference)
    }

    if (blocksToCreate.length > 0) {
      await newBlocksTable.bulkPut(blocksToCreate)
    }
    topicUpdates[oldTopic.id] = { messages: newMessagesForTopic }
  })

  const updateOperations = Object.entries(topicUpdates).map(([id, data]) => ({ key: id, changes: data }))
  if (updateOperations.length > 0) {
    await oldTopicsTable.bulkUpdate(updateOperations)
    logger.info(`Updated message references for ${updateOperations.length} topics.`)
  }

  logger.info('DB migration to version 7 finished successfully.')
}

export async function upgradeToV8(tx: Transaction): Promise<void> {
  logger.info('DB migration to version 8 started')

  const langMap: Record<string, TranslateLanguageCode> = {
    english: 'en-us',
    chinese: 'zh-cn',
    'chinese-traditional': 'zh-tw',
    japanese: 'ja-jp',
    korean: 'ko-kr',
    french: 'fr-fr',
    german: 'de-de',
    italian: 'it-it',
    spanish: 'es-es',
    portuguese: 'pt-pt',
    russian: 'ru-ru',
    polish: 'pl-pl',
    arabic: 'ar-ar',
    turkish: 'tr-tr',
    thai: 'th-th',
    vietnamese: 'vi-vn',
    indonesian: 'id-id',
    urdu: 'ur-pk',
    malay: 'ms-my'
  }

  const settingsTable = tx.table('settings')
  const defaultPair: [TranslateLanguageCode, TranslateLanguageCode] = [
    LanguagesEnum.enUS.langCode,
    LanguagesEnum.zhCN.langCode
  ]
  const originSource = (await settingsTable.get('translate:source:language'))?.value
  const originTarget = (await settingsTable.get('translate:target:language'))?.value
  const originPair = (await settingsTable.get('translate:bidirectional:pair'))?.value
  let newSource, newTarget, newPair
  logger.info('originSource: %o', originSource)
  if (originSource === 'auto') {
    newSource = 'auto'
  } else {
    newSource = langMap[originSource]
    if (!newSource) {
      newSource = LanguagesEnum.enUS.langCode
    }
  }

  logger.info('originTarget: %o', originTarget)
  newTarget = langMap[originTarget]
  if (!newTarget) {
    newTarget = LanguagesEnum.zhCN.langCode
  }

  logger.info('originPair: %o', originPair)
  if (!originPair || !originPair[0] || !originPair[1]) {
    newPair = defaultPair
  } else {
    newPair = [langMap[originPair[0]], langMap[originPair[1]]]
  }

  logger.info('DB migration to version 8: %o', { newSource, newTarget, newPair })

  await settingsTable.put({ id: 'translate:bidirectional:pair', value: newPair })
  await settingsTable.put({ id: 'translate:source:language', value: newSource })
  await settingsTable.put({ id: 'translate:target:language', value: newTarget })

  const histories = tx.table('translate_history')

  for (const history of await histories.toArray()) {
    try {
      await tx.table('translate_history').put({
        ...history,
        sourceLanguage: langMap[history.sourceLanguage],
        targetLanguage: langMap[history.targetLanguage]
      })
    } catch (error) {
      logger.error('Error upgrading history:', error as Error)
    }
  }
  logger.info('DB migration to version 8 finished.')
}
