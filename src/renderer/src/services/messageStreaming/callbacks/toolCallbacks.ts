import { loggerService } from '@logger'
import type { MCPToolResponse } from '@renderer/types'
import { MessageBlockStatus, MessageBlockType, ToolMessageBlock } from '@renderer/types/newMessage'
import { createToolBlock } from '@renderer/utils/messageUtils/create'

import { BlockManager } from '../BlockManager'

const logger = loggerService.withContext('ToolCallbacks')

interface ToolCallbacksDependencies {
  blockManager: BlockManager
  assistantMsgId: string
}

export const createToolCallbacks = (deps: ToolCallbacksDependencies) => {
  const { blockManager, assistantMsgId } = deps

  // 内部维护的状态
  const toolCallIdToBlockIdMap = new Map<string, string>()
  let toolBlockId: string | null = null

  return {
    onToolCallPending: (toolResponse: MCPToolResponse) => {
      if (blockManager.hasInitialPlaceholder) {
        const changes = {
          type: MessageBlockType.TOOL,
          status: MessageBlockStatus.PENDING,
          toolName: toolResponse.tool.name,
          metadata: { rawMcpToolResponse: toolResponse }
        }
        toolBlockId = blockManager.initialPlaceholderBlockId!
        blockManager.smartBlockUpdate(toolBlockId, changes, MessageBlockType.TOOL)
        toolCallIdToBlockIdMap.set(toolResponse.id, toolBlockId)
      } else if (toolResponse.status === 'pending') {
        const toolBlock = createToolBlock(assistantMsgId, toolResponse.id, {
          toolName: toolResponse.tool.name,
          status: MessageBlockStatus.PENDING,
          metadata: { rawMcpToolResponse: toolResponse }
        })
        toolBlockId = toolBlock.id
        blockManager.handleBlockTransition(toolBlock, MessageBlockType.TOOL)
        toolCallIdToBlockIdMap.set(toolResponse.id, toolBlock.id)
      } else {
        logger.warn(
          `[onToolCallPending] Received unhandled tool status: ${toolResponse.status} for ID: ${toolResponse.id}`
        )
      }
    },

    onToolCallInProgress: (toolResponse: MCPToolResponse) => {
      // 根据 toolResponse.id 查找对应的块ID
      const targetBlockId = toolCallIdToBlockIdMap.get(toolResponse.id)

      if (targetBlockId && toolResponse.status === 'invoking') {
        const changes = {
          status: MessageBlockStatus.PROCESSING,
          metadata: { rawMcpToolResponse: toolResponse }
        }
        blockManager.smartBlockUpdate(targetBlockId, changes, MessageBlockType.TOOL)
      } else if (!targetBlockId) {
        logger.warn(
          `[onToolCallInProgress] No block ID found for tool ID: ${toolResponse.id}. Available mappings:`,
          Array.from(toolCallIdToBlockIdMap.entries())
        )
      } else {
        logger.warn(
          `[onToolCallInProgress] Received unhandled tool status: ${toolResponse.status} for ID: ${toolResponse.id}`
        )
      }
    },

    onToolCallComplete: (toolResponse: MCPToolResponse) => {
      const existingBlockId = toolCallIdToBlockIdMap.get(toolResponse.id)
      toolCallIdToBlockIdMap.delete(toolResponse.id)

      if (toolResponse.status === 'done' || toolResponse.status === 'error' || toolResponse.status === 'cancelled') {
        if (!existingBlockId) {
          logger.error(
            `[onToolCallComplete] No existing block found for completed/error tool call ID: ${toolResponse.id}. Cannot update.`
          )
          return
        }

        const finalStatus =
          toolResponse.status === 'done' || toolResponse.status === 'cancelled'
            ? MessageBlockStatus.SUCCESS
            : MessageBlockStatus.ERROR

        const changes: Partial<ToolMessageBlock> = {
          content: toolResponse.response,
          status: finalStatus,
          metadata: { rawMcpToolResponse: toolResponse }
        }

        if (finalStatus === MessageBlockStatus.ERROR) {
          changes.error = { message: `Tool execution failed/error`, details: toolResponse.response }
        }

        blockManager.smartBlockUpdate(existingBlockId, changes, MessageBlockType.TOOL, true)
      } else {
        logger.warn(
          `[onToolCallComplete] Received unhandled tool status: ${toolResponse.status} for ID: ${toolResponse.id}`
        )
      }

      toolBlockId = null
    }
  }
}
