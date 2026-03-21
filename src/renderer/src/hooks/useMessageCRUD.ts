import { loggerService } from '@logger'
import store, { useAppDispatch } from '@renderer/store'
import {
  deleteMessageGroupThunk,
  deleteSingleMessageThunk,
  removeBlocksThunk,
  updateMessageAndBlocksThunk
} from '@renderer/store/thunk/messageThunk'
import { objectKeys } from '@renderer/types'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import difference from 'lodash/difference'
import { useCallback } from 'react'

const logger = loggerService.withContext('UseMessageCRUD')

/**
 * Hook 提供消息的基本 CRUD 操作
 * @param topicId 主题ID
 */
export function useMessageCRUD(topicId: string) {
  const dispatch = useAppDispatch()

  /**
   * 删除单个消息。 / Deletes a single message.
   * Dispatches deleteSingleMessageThunk.
   */
  const deleteMessage = useCallback(
    async (id: string, traceId?: string, modelName?: string) => {
      await dispatch(deleteSingleMessageThunk(topicId, id))
      window.api.trace.cleanHistory(topicId, traceId || '', modelName)
    },
    [dispatch, topicId]
  )

  /**
   * 删除一组消息（基于 askId）。 / Deletes a group of messages (based on askId).
   * Dispatches deleteMessageGroupThunk.
   */
  const deleteGroupMessages = useCallback(
    async (askId: string) => {
      await dispatch(deleteMessageGroupThunk(topicId, askId))
    },
    [dispatch, topicId]
  )

  /**
   * 编辑消息。 / Edits a message.
   * 使用 newMessagesActions.updateMessage.
   */
  const editMessage = useCallback(
    async (messageId: string, updates: Partial<Omit<Message, 'id' | 'topicId' | 'blocks'>>) => {
      if (!topicId) {
        logger.error('[editMessage] Topic ID is not valid.')
        return
      }
      const uiStates = ['multiModelMessageStyle', 'foldSelected'] as const satisfies (keyof Message)[]
      const extraUpdate = difference(objectKeys(updates), uiStates)
      const isUiUpdateOnly = extraUpdate.length === 0
      const messageUpdates: Partial<Message> & Pick<Message, 'id'> = {
        id: messageId,
        updatedAt: isUiUpdateOnly ? undefined : new Date().toISOString(),
        ...updates
      }

      await dispatch(updateMessageAndBlocksThunk(topicId, messageUpdates, []))
    },
    [dispatch, topicId]
  )

  /**
   * Updates message blocks by comparing original and edited blocks.
   * Handles adding, updating, and removing blocks in a single operation.
   * @param messageId The ID of the message to update
   * @param editedBlocks The complete set of blocks after editing
   */
  const editMessageBlocks = useCallback(
    async (messageId: string, editedBlocks: MessageBlock[]) => {
      if (!topicId) {
        logger.error('[editMessageBlocks] Topic ID is not valid.')
        return
      }

      try {
        const state = store.getState()
        const message = state.messages.entities[messageId]
        if (!message) {
          logger.error(`[editMessageBlocks] Message not found: ${messageId}`)
          return
        }

        const originalBlocks = message.blocks
          ? (message.blocks
              .map((blockId) => state.messageBlocks.entities[blockId])
              .filter((block) => block !== undefined) as MessageBlock[])
          : []

        const originalBlockIds = new Set(originalBlocks.map((block) => block.id))
        const editedBlockIds = new Set(editedBlocks.map((block) => block.id))

        const blockIdsToRemove = originalBlocks
          .filter((block) => !editedBlockIds.has(block.id))
          .map((block) => block.id)

        const blocksToUpdate = editedBlocks
          .filter((block) => originalBlockIds.has(block.id))
          .map((block) => ({
            ...block,
            updatedAt: new Date().toISOString()
          }))

        const blocksToAdd = editedBlocks
          .filter((block) => !originalBlockIds.has(block.id))
          .map((block) => ({
            ...block,
            updatedAt: new Date().toISOString()
          }))

        const updatedBlockIds = editedBlocks.map((block) => block.id)
        const messageUpdates: Partial<Message> & Pick<Message, 'id'> = {
          id: messageId,
          updatedAt: new Date().toISOString(),
          blocks: updatedBlockIds
        }

        if (blocksToAdd.length > 0) {
          await dispatch(updateMessageAndBlocksThunk(topicId, messageUpdates, blocksToAdd))
        }

        if (blocksToUpdate.length > 0) {
          await dispatch(updateMessageAndBlocksThunk(topicId, messageUpdates, blocksToUpdate))
        }

        if (blockIdsToRemove.length > 0) {
          await dispatch(removeBlocksThunk(topicId, messageId, blockIdsToRemove))
        }
      } catch (error) {
        logger.error('[editMessageBlocks] Failed to update message blocks:', error as Error)
      }
    },
    [dispatch, topicId]
  )

  /**
   * 移除单个消息块。 / Removes a single message block.
   */
  const removeMessageBlock = useCallback(
    async (messageId: string, blockIdToRemove: string) => {
      if (!topicId) {
        logger.error('[removeMessageBlock] Topic ID is not valid.')
        return
      }

      const state = store.getState()
      const message = state.messages.entities[messageId]
      if (!message || !message.blocks) {
        logger.error(`[removeMessageBlock] Message not found or has no blocks: ${messageId}`)
        return
      }

      const updatedBlocks = message.blocks.filter((blockId) => blockId !== blockIdToRemove)

      const messageUpdates: Partial<Message> & Pick<Message, 'id'> = {
        id: messageId,
        updatedAt: new Date().toISOString(),
        blocks: updatedBlocks
      }

      await dispatch(updateMessageAndBlocksThunk(topicId, messageUpdates, []))
    },
    [dispatch, topicId]
  )

  return {
    deleteMessage,
    deleteGroupMessages,
    editMessage,
    editMessageBlocks,
    removeMessageBlock
  }
}
