import type { Message as OldMessage, Topic } from '@renderer/types'
import { FileTypes } from '@renderer/types' // Import FileTypes enum
import type {
  BaseMessageBlock,
  CitationBlock,
  Message as NewMessage,
  MessageBlock
} from '@renderer/types/newMessageTypes'
import { MessageBlockStatus } from '@renderer/types/newMessageTypes'
import { Transaction } from 'dexie'

import {
  createCitationBlock,
  createErrorBlock,
  createFileBlock,
  createImageBlock,
  createMainTextBlock,
  createThinkingBlock,
  createToolBlock, // Changed
  createTranslationBlock, // Added
  createWebSearchMessageBlock
} from '../utils/messageUtils/create'

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

// --- Helper functions for status mapping (Moved from index.ts) ---
function mapOldStatusToBlockStatus(oldStatus: OldMessage['status']): MessageBlockStatus {
  if (oldStatus === 'success') return MessageBlockStatus.SUCCESS
  if (oldStatus === 'error') return MessageBlockStatus.ERROR
  if (oldStatus === 'paused') return MessageBlockStatus.PAUSED
  if (oldStatus === 'pending') return MessageBlockStatus.PENDING
  if (oldStatus === 'searching' || oldStatus === 'sending') return MessageBlockStatus.PROCESSING
  return MessageBlockStatus.PENDING // Default
}

function mapOldStatusToNewMessageStatus(oldStatus: OldMessage['status']): NewMessage['status'] {
  if (oldStatus === 'success') return 'success'
  if (oldStatus === 'error') return 'error'
  if (oldStatus === 'paused') return 'paused'
  if (oldStatus === 'pending' || oldStatus === 'searching' || oldStatus === 'sending') {
    return 'processing' // Map intermediate states to processing initially
  }
  return 'processing' // Default
}

// --- NEW UPGRADE FUNCTION for Version 7 ---
export async function upgradeToV7(tx: Transaction): Promise<void> {
  console.log('Starting DB migration to version 7: Normalizing messages and blocks...')

  const oldTopicsTable = tx.table('topics')
  const newBlocksTable = tx.table('message_blocks')
  const topicUpdates: Record<string, { messages: NewMessage[] }> = {}

  try {
    await oldTopicsTable.toCollection().each(async (oldTopic: Pick<Topic, 'id'> & { messages: OldMessage[] }) => {
      const newMessagesForTopic: NewMessage[] = []
      const blocksToCreate: MessageBlock[] = []

      if (!oldTopic.messages || !Array.isArray(oldTopic.messages)) {
        console.warn(`Topic ${oldTopic.id} has no valid messages array, skipping.`)
        topicUpdates[oldTopic.id] = { messages: [] }
        return
      }

      for (const oldMessage of oldTopic.messages) {
        const messageBlockIds: string[] = []
        const citationDataToCreate: Partial<Omit<CitationBlock, keyof BaseMessageBlock | 'type'>> = {}

        // 1. Main Text Block
        if (oldMessage.content?.trim()) {
          const block = createMainTextBlock(oldMessage.id, oldMessage.content, {
            createdAt: oldMessage.createdAt,
            status: mapOldStatusToBlockStatus(oldMessage.status),
            // Optionally migrate usage, metrics if needed
            usage: oldMessage.usage,
            metrics: oldMessage.metrics,
            knowledgeBaseIds: oldMessage.knowledgeBaseIds
          })
          blocksToCreate.push(block)
          messageBlockIds.push(block.id)
        }

        // 2. Thinking Block (from reasoning_content)
        if (oldMessage.reasoning_content?.trim()) {
          const block = createThinkingBlock(oldMessage.id, oldMessage.reasoning_content, {
            createdAt: oldMessage.createdAt,
            status: MessageBlockStatus.SUCCESS
          })
          blocksToCreate.push(block)
          messageBlockIds.push(block.id)
        }

        // 3. Translation Block
        if (oldMessage.translatedContent?.trim()) {
          const block = createTranslationBlock(oldMessage.id, oldMessage.translatedContent, 'unknown', {
            createdAt: oldMessage.createdAt,
            status: MessageBlockStatus.SUCCESS
          })
          blocksToCreate.push(block)
          messageBlockIds.push(block.id)
        }

        // 4. File Blocks (Non-Image) and Image Blocks (from Files)
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

        // 5. Image Blocks (from Metadata - AI Generated)
        if (oldMessage.metadata?.generateImage) {
          const block = createImageBlock(oldMessage.id, {
            metadata: { generateImageResponse: oldMessage.metadata.generateImage },
            createdAt: oldMessage.createdAt,
            status: MessageBlockStatus.SUCCESS
          })
          blocksToCreate.push(block)
          messageBlockIds.push(block.id)
        }

        // 6. Web Search Block
        if (oldMessage.metadata?.webSearch?.results?.length) {
          const block = createWebSearchMessageBlock(oldMessage.id, oldMessage.metadata.webSearch.results, {
            query: oldMessage.metadata.webSearch.query,
            createdAt: oldMessage.createdAt,
            status: MessageBlockStatus.SUCCESS
          })
          blocksToCreate.push(block)
          messageBlockIds.push(block.id)
        }

        // 7. Tool Blocks (from mcpTools)
        if (oldMessage.metadata?.mcpTools?.length) {
          oldMessage.metadata.mcpTools.forEach((mcpTool) => {
            const block = createToolBlock(oldMessage.id, mcpTool.id, {
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
        let hasCitationData = false
        // 8. Collect Citation Data (into a single object for the message)
        if (oldMessage.metadata?.groundingMetadata) {
          hasCitationData = true
          citationDataToCreate.citationType = 'grounding'
          citationDataToCreate.groundingMetadata = oldMessage.metadata.groundingMetadata
          citationDataToCreate.originalData = oldMessage.metadata.groundingMetadata
          citationDataToCreate.sourceName = 'Gemini Grounding'
        } else if (oldMessage.metadata?.citations?.length) {
          hasCitationData = true
          citationDataToCreate.citationType = 'citation'
          citationDataToCreate.citations = oldMessage.metadata.citations
          citationDataToCreate.originalData = oldMessage.metadata.citations
          citationDataToCreate.sourceName = 'Citation URLs'
        } else if (oldMessage.metadata?.annotations?.length) {
          hasCitationData = true
          citationDataToCreate.citationType = 'annotation'
          citationDataToCreate.annotations = oldMessage.metadata.annotations
          citationDataToCreate.originalData = oldMessage.metadata.annotations
          citationDataToCreate.sourceName = 'OpenAI Annotations'
        } else if (oldMessage.metadata?.webSearchInfo) {
          hasCitationData = true
          citationDataToCreate.citationType = 'webSearchInfo'
          citationDataToCreate.webSearchInfo = oldMessage.metadata.webSearchInfo
          citationDataToCreate.originalData = oldMessage.metadata.webSearchInfo
          citationDataToCreate.sourceName = 'Web Search Info'
        }

        // 9. Create Citation Block (if data was collected)
        if (hasCitationData) {
          const block = createCitationBlock(
            oldMessage.id,
            citationDataToCreate as Omit<CitationBlock, keyof BaseMessageBlock | 'type'>,
            {
              createdAt: oldMessage.createdAt
            }
          )
          blocksToCreate.push(block)
          messageBlockIds.push(block.id)
        }

        // 10. Error Block
        if (oldMessage.error && typeof oldMessage.error === 'object' && Object.keys(oldMessage.error).length > 0) {
          const block = createErrorBlock(oldMessage.id, oldMessage.error, {
            createdAt: oldMessage.createdAt
          })
          blocksToCreate.push(block)
          messageBlockIds.push(block.id)
        }

        // 11. Create the New Message reference object
        const newMessageReference: NewMessage = {
          id: oldMessage.id,
          role: oldMessage.role as NewMessage['role'],
          assistantId: oldMessage.assistantId || '',
          topicId: oldTopic.id,
          createdAt: oldMessage.createdAt,
          status: mapOldStatusToNewMessageStatus(oldMessage.status),
          modelId: oldMessage.modelId,
          model: oldMessage.model,
          type: oldMessage.type,
          isPreset: oldMessage.isPreset,
          useful: oldMessage.useful,
          askId: oldMessage.askId,
          mentions: oldMessage.mentions,
          enabledMCPs: oldMessage.enabledMCPs,
          multiModelMessageStyle: oldMessage.multiModelMessageStyle as NewMessage['multiModelMessageStyle'],
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
      console.log(`Updated message references for ${updateOperations.length} topics.`)
    }

    console.log('DB migration to version 7 finished successfully.')
  } catch (error) {
    console.error('Error during DB migration to version 7:', error)
  }
}
