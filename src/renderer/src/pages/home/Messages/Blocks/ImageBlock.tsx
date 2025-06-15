import ImageViewer from '@renderer/components/ImageViewer'
import store, { useAppDispatch } from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import { updateMessageAndBlocksThunk } from '@renderer/store/thunk/messageThunk'
import { type ImageMessageBlock, MessageBlockStatus } from '@renderer/types/newMessage'
import { Skeleton } from 'antd'
import React, { useCallback } from 'react'
import styled from 'styled-components'

interface Props {
  block: ImageMessageBlock
}

const ImageBlock: React.FC<Props> = ({ block }) => {
  const dispatch = useAppDispatch()
  const onImageLocalized = useCallback(
    async (localizedUrl: string, originalUrl: string) => {
      const state = store.getState()
      const originalBlock = messageBlocksSelectors.selectById(state, block.id) as ImageMessageBlock

      const updatedBlock = {
        ...originalBlock,
        metadata: {
          ...originalBlock.metadata,
          generateImageResponse: {
            ...originalBlock.metadata!.generateImageResponse!,
            images: originalBlock!.metadata!.generateImageResponse!.images.map((img) =>
              img === originalUrl ? localizedUrl : img
            )
          }
        },
        updatedAt: new Date().toISOString()
      }
      const updatedMessage = {
        ...state.messages.entities[originalBlock.messageId],
        updatedAt: new Date().toISOString()
      }

      await dispatch(updateMessageAndBlocksThunk(updatedMessage.topicId, updatedMessage, [updatedBlock]))
    },
    [block.id, dispatch]
  )

  if (block.status === MessageBlockStatus.STREAMING || block.status === MessageBlockStatus.PROCESSING)
    return <Skeleton.Image active style={{ width: 200, height: 200 }} />
  if (block.status === MessageBlockStatus.SUCCESS) {
    const imageUrls: string[] = []
    if (block.metadata?.generateImageResponse?.images?.length) {
      imageUrls.push(...block.metadata.generateImageResponse.images)
    } else if (block?.file?.path) {
      imageUrls.push(new URL(block.file.path, 'file:').href)
    }

    return (
      <Container style={{ marginBottom: 8 }}>
        {imageUrls.map((url, index) => (
          <ImageViewer
            src={url}
            key={`image-${index}`}
            style={{ maxWidth: 500, maxHeight: 500, padding: 5, borderRadius: 8 }}
            onImageLocalized={onImageLocalized}
          />
        ))}
      </Container>
    )
  } else return null
}
const Container = styled.div`
  display: flex;
  flex-direction: row;
  gap: 10px;
  margin-top: 8px;
`
export default React.memo(ImageBlock)
