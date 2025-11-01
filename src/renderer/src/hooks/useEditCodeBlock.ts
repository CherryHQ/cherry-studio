import { loggerService } from '@logger'
import store, { useAppDispatch } from '@renderer/store'
import { messageBlocksSelectors, updateOneBlock } from '@renderer/store/messageBlock'
import { updateMessageAndBlocksThunk } from '@renderer/store/thunk/messageThunk'
import type { MessageBlock } from '@renderer/types/newMessage'
import { MessageBlockType } from '@renderer/types/newMessage'
import { updateCodeBlock } from '@renderer/utils/markdown'
import { isTextLikeBlock } from '@renderer/utils/messageUtils/is'
import { t } from 'i18next'
import { useCallback } from 'react'

const logger = loggerService.withContext('useEditCodeBlock')

export const useEditCodeBlock = () => {
  const dispatch = useAppDispatch()

  const editCodeBlock = useCallback(
    async (data: { topicId: string; msgBlockId: string; codeBlockId: string; newContent: string }) => {
      const { topicId, msgBlockId, codeBlockId, newContent } = data

      const msgBlock = messageBlocksSelectors.selectById(store.getState(), msgBlockId)

      // FIXME: 目前 error block 没有 content
      if (msgBlock && isTextLikeBlock(msgBlock) && msgBlock.type !== MessageBlockType.ERROR) {
        try {
          const updatedRaw = updateCodeBlock(msgBlock.content, codeBlockId, newContent)
          const updatedBlock: MessageBlock = {
            ...msgBlock,
            content: updatedRaw,
            updatedAt: new Date().toISOString()
          }

          dispatch(updateOneBlock({ id: msgBlockId, changes: { content: updatedRaw } }))
          await dispatch(updateMessageAndBlocksThunk(topicId, null, [updatedBlock]))

          window.toast.success(t('code_block.edit.save.success'))
        } catch (error) {
          logger.error(
            `Failed to save code block ${codeBlockId} content to message block ${msgBlockId}:`,
            error as Error
          )
          window.toast.error(t('code_block.edit.save.failed.label'))
        }
      } else {
        logger.error(
          `Failed to save code block ${codeBlockId} content to message block ${msgBlockId}: no such message block or the block doesn't have a content field`
        )
        window.toast.error(t('code_block.edit.save.failed.label'))
      }
    },
    [dispatch]
  )

  return editCodeBlock
}
