import ImageViewer from '@renderer/components/ImageViewer'
import FileManager from '@renderer/services/FileManager'
import store, { useAppDispatch } from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import { updateMessageAndBlocksThunk } from '@renderer/store/thunk/messageThunk'
import { type ImageMessageBlock, MessageBlockStatus } from '@renderer/types/newMessage'
import { Skeleton } from 'antd'
import React, { useCallback } from 'react'
import styled from 'styled-components'

interface Props {
  block: ImageMessageBlock
  isSingle?: boolean
}

const ImageBlock: React.FC<Props> = ({ block, isSingle = false }) => {
  const dispatch = useAppDispatch()
  const onImageLocalized = useCallback(
    async (localizedUrl: string, originalUrl: string) => {
      const state = store.getState()
      const originalBlock = messageBlocksSelectors.selectById(state, block.id) as ImageMessageBlock

      if (!originalBlock.metadata?.generateImageResponse?.images) {
        return
      }

      const originalImages = originalBlock.metadata.generateImageResponse.images
      const updatedImages = originalImages.map((img) => (img === originalUrl ? localizedUrl : img))

      const updatedBlock: ImageMessageBlock = {
        ...originalBlock,
        metadata: {
          ...originalBlock.metadata,
          generateImageResponse: {
            ...originalBlock.metadata.generateImageResponse,
            images: updatedImages
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

  if (block.status === MessageBlockStatus.PENDING) {
    return <Skeleton.Image active style={{ width: 200, height: 200 }} />
  }

  if (block.status === MessageBlockStatus.STREAMING || block.status === MessageBlockStatus.SUCCESS) {
    const images = block.metadata?.generateImageResponse?.images?.length
      ? block.metadata?.generateImageResponse?.images
      : block?.file
        ? [`file://${FileManager.getFilePath(block?.file)}`]
        : []

    return (
      <Container>
        {images.map((src, index) => (
          <ImageViewer
            src={src}
            key={`image-${index}`}
            style={
              isSingle
                ? { maxWidth: 500, maxHeight: 'min(500px, 50vh)', padding: 0, borderRadius: 8 }
                : { width: 280, height: 280, objectFit: 'cover', padding: 0, borderRadius: 8 }
            }
            onImageLocalized={onImageLocalized}
          />
        ))}
      </Container>
    )
  }

  return null
}

const Container = styled.div`
  display: block;
`
export default React.memo(ImageBlock)
