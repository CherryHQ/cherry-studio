import { loggerService } from '@logger'
import type { AppDispatch } from '@renderer/store'
import store from '@renderer/store'
import { toolPermissionsActions } from '@renderer/store/toolPermissions'
import type { MCPToolResponse, NormalToolResponse } from '@renderer/types'
import { WEB_SEARCH_SOURCE } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { MESSAGE_BLOCK_STATUS, MESSAGE_BLOCK_TYPE } from '@renderer/types/newMessage'
import { createCitationBlock, createToolBlock } from '@renderer/utils/messageUtils/create'
import { isPlainObject } from 'lodash'

import type { BlockManager } from '../BlockManager'

const logger = loggerService.withContext('ToolCallbacks')

type ToolResponse = MCPToolResponse | NormalToolResponse

interface ToolCallbacksDependencies {
  blockManager: BlockManager
  assistantMsgId: string
  dispatch: AppDispatch
}

export const createToolCallbacks = (deps: ToolCallbacksDependencies) => {
  const { blockManager, assistantMsgId, dispatch } = deps

  // 内部维护的状态
  const toolCallIdToBlockIdMap = new Map<string, string>()
  let toolBlockId: string | null = null
  let citationBlockId: string | null = null

  return {
    onToolCallPending: (toolResponse: ToolResponse) => {
      logger.debug('onToolCallPending', toolResponse)

      if (blockManager.hasInitialPlaceholder) {
        const changes = {
          type: MESSAGE_BLOCK_TYPE.TOOL,
          status: MESSAGE_BLOCK_STATUS.PENDING,
          toolName: toolResponse.tool.name,
          metadata: { rawMcpToolResponse: toolResponse }
        }
        toolBlockId = blockManager.initialPlaceholderBlockId!
        blockManager.smartBlockUpdate(toolBlockId, changes, MESSAGE_BLOCK_TYPE.TOOL)
        toolCallIdToBlockIdMap.set(toolResponse.id, toolBlockId)
      } else if (toolResponse.status === 'pending') {
        const toolBlock = createToolBlock(assistantMsgId, toolResponse.id, {
          toolName: toolResponse.tool.name,
          status: MESSAGE_BLOCK_STATUS.PENDING,
          metadata: { rawMcpToolResponse: toolResponse }
        })
        toolBlockId = toolBlock.id
        blockManager.handleBlockTransition(toolBlock, MESSAGE_BLOCK_TYPE.TOOL)
        toolCallIdToBlockIdMap.set(toolResponse.id, toolBlock.id)
      } else {
        logger.warn(
          `[onToolCallPending] Received unhandled tool status: ${toolResponse.status} for ID: ${toolResponse.id}`
        )
      }
    },

    onToolArgumentStreaming: (toolResponse: ToolResponse) => {
      // Find or create the tool block for streaming updates
      let existingBlockId = toolCallIdToBlockIdMap.get(toolResponse.id)

      if (!existingBlockId) {
        // Create a new tool block if one doesn't exist yet
        if (blockManager.hasInitialPlaceholder) {
          const changes = {
            type: MESSAGE_BLOCK_TYPE.TOOL,
            status: MESSAGE_BLOCK_STATUS.PENDING,
            toolName: toolResponse.tool.name,
            metadata: { rawMcpToolResponse: toolResponse }
          }
          toolBlockId = blockManager.initialPlaceholderBlockId!
          blockManager.smartBlockUpdate(toolBlockId, changes, MESSAGE_BLOCK_TYPE.TOOL)
          toolCallIdToBlockIdMap.set(toolResponse.id, toolBlockId)
          existingBlockId = toolBlockId
        } else {
          const toolBlock = createToolBlock(assistantMsgId, toolResponse.id, {
            toolName: toolResponse.tool.name,
            status: MESSAGE_BLOCK_STATUS.PENDING,
            metadata: { rawMcpToolResponse: toolResponse }
          })
          toolBlockId = toolBlock.id
          blockManager.handleBlockTransition(toolBlock, MESSAGE_BLOCK_TYPE.TOOL)
          toolCallIdToBlockIdMap.set(toolResponse.id, toolBlock.id)
          existingBlockId = toolBlock.id
        }
      }

      // Update the tool block with streaming arguments
      const changes: Partial<ToolMessageBlock> = {
        status: MESSAGE_BLOCK_STATUS.PENDING,
        metadata: { rawMcpToolResponse: toolResponse }
      }

      blockManager.smartBlockUpdate(existingBlockId, changes, MESSAGE_BLOCK_TYPE.TOOL)
    },

    onToolCallComplete: (toolResponse: ToolResponse) => {
      // Read resolvedInput BEFORE removing from store (removeByToolCallId deletes it)
      const state = store.getState()
      const resolvedInput = toolResponse?.id ? state.toolPermissions.resolvedInputs[toolResponse.id] : undefined

      if (toolResponse?.id) {
        dispatch(toolPermissionsActions.removeByToolCallId({ toolCallId: toolResponse.id }))
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
            ? MESSAGE_BLOCK_STATUS.SUCCESS
            : MESSAGE_BLOCK_STATUS.ERROR

        const existingBlock = state.messageBlocks.entities[existingBlockId] as ToolMessageBlock | undefined

        const existingResponse = existingBlock?.metadata?.rawMcpToolResponse
        // Merge order: toolResponse.arguments (base) -> existingResponse?.arguments -> resolvedInput (user answers take precedence)
        const mergedArguments = Object.assign(
          {},
          isPlainObject(toolResponse.arguments) ? toolResponse.arguments : null,
          isPlainObject(existingResponse?.arguments) ? existingResponse?.arguments : null,
          isPlainObject(resolvedInput) ? resolvedInput : null
        )

        const mergedToolResponse: MCPToolResponse | NormalToolResponse = {
          ...(existingResponse ?? toolResponse),
          ...toolResponse,
          arguments: mergedArguments
        }

        const changes: Partial<ToolMessageBlock> = {
          // @ts-ignore FIXME: type validation is bypassed
          content: toolResponse.response,
          status: finalStatus,
          metadata: { rawMcpToolResponse: mergedToolResponse }
        }

        if (finalStatus === MESSAGE_BLOCK_STATUS.ERROR) {
          changes.error = {
            message: `Tool execution failed/error`,
            // @ts-ignore FIXME: type validation is bypassed
            details: toolResponse.response,
            name: null,
            stack: null
          }
        }
        blockManager.smartBlockUpdate(existingBlockId, changes, MESSAGE_BLOCK_TYPE.TOOL, true)
        // Handle citation block creation for web search results
        if (toolResponse.tool.name === 'builtin_web_search' && toolResponse.response) {
          const citationBlock = createCitationBlock(
            assistantMsgId,
            {
              response: { results: toolResponse.response, source: WEB_SEARCH_SOURCE.WEBSEARCH }
            },
            {
              status: MESSAGE_BLOCK_STATUS.SUCCESS
            }
          )
          citationBlockId = citationBlock.id
          blockManager.handleBlockTransition(citationBlock, MESSAGE_BLOCK_TYPE.CITATION)
        }
        if (toolResponse.tool.name === 'builtin_knowledge_search' && toolResponse.response) {
          const citationBlock = createCitationBlock(
            assistantMsgId,
            // @ts-ignore FIXME: type validation is bypassed
            { knowledge: toolResponse.response },
            {
              status: MESSAGE_BLOCK_STATUS.SUCCESS
            }
          )
          citationBlockId = citationBlock.id
          blockManager.handleBlockTransition(citationBlock, MESSAGE_BLOCK_TYPE.CITATION)
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
