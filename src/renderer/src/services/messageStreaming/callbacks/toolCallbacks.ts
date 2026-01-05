/**
 * @fileoverview Tool callbacks for handling MCP tool calls during streaming
 *
 * This module provides callbacks for processing tool calls:
 * - Tool call pending: create tool block when tool is called
 * - Tool call complete: update with result or error
 *
 * ARCHITECTURE NOTE:
 * These callbacks now use StreamingService for state management instead of Redux dispatch.
 * This is part of the v2 data refactoring to use CacheService + Data API.
 *
 * NOTE: toolPermissionsActions dispatch is still required for permission management
 * as this is outside the scope of streaming state management.
 */

import { loggerService } from '@logger'
import store from '@renderer/store'
import { toolPermissionsActions } from '@renderer/store/toolPermissions'
import type { MCPToolResponse } from '@renderer/types'
import { WebSearchSource } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { createCitationBlock, createToolBlock } from '@renderer/utils/messageUtils/create'

import type { BlockManager } from '../BlockManager'

const logger = loggerService.withContext('ToolCallbacks')

/**
 * Dependencies required for tool callbacks
 *
 * NOTE: dispatch removed - toolPermissions uses store.dispatch directly
 * since it's outside streaming state scope.
 */
interface ToolCallbacksDependencies {
  blockManager: BlockManager
  assistantMsgId: string
}

export const createToolCallbacks = (deps: ToolCallbacksDependencies) => {
  const { blockManager, assistantMsgId } = deps

  // 内部维护的状态
  const toolCallIdToBlockIdMap = new Map<string, string>()
  let toolBlockId: string | null = null
  let citationBlockId: string | null = null

  return {
    onToolCallPending: (toolResponse: MCPToolResponse) => {
      logger.debug('onToolCallPending', toolResponse)

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

    onToolCallComplete: (toolResponse: MCPToolResponse) => {
      if (toolResponse?.id) {
        // Use store.dispatch for permission cleanup (outside streaming state scope)
        store.dispatch(toolPermissionsActions.removeByToolCallId({ toolCallId: toolResponse.id }))
      }
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
          changes.error = {
            message: `Tool execution failed/error`,
            details: toolResponse.response,
            name: null,
            stack: null
          }
        }
        blockManager.smartBlockUpdate(existingBlockId, changes, MessageBlockType.TOOL, true)
        // Handle citation block creation for web search results
        if (toolResponse.tool.name === 'builtin_web_search' && toolResponse.response) {
          const citationBlock = createCitationBlock(
            assistantMsgId,
            {
              response: { results: toolResponse.response, source: WebSearchSource.WEBSEARCH }
            },
            {
              status: MessageBlockStatus.SUCCESS
            }
          )
          citationBlockId = citationBlock.id
          blockManager.handleBlockTransition(citationBlock, MessageBlockType.CITATION)
        }
        if (toolResponse.tool.name === 'builtin_knowledge_search' && toolResponse.response) {
          const citationBlock = createCitationBlock(
            assistantMsgId,
            { knowledge: toolResponse.response },
            {
              status: MessageBlockStatus.SUCCESS
            }
          )
          citationBlockId = citationBlock.id
          blockManager.handleBlockTransition(citationBlock, MessageBlockType.CITATION)
        }
      } else {
        logger.warn(
          `[onToolCallComplete] Received unhandled tool status: ${toolResponse.status} for ID: ${toolResponse.id}`
        )
      }

      toolBlockId = null
    },

    // 暴露给 textCallbacks 使用的方法
    getCitationBlockId: () => citationBlockId
  }
}
