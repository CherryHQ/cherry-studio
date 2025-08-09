import ImageViewer from '@renderer/components/ImageViewer'
import FileManager from '@renderer/services/FileManager'
import { type ImageMessageBlock, MessageBlockStatus } from '@renderer/types/newMessage'
import { Skeleton } from 'antd'
import React from 'react'
import styled from 'styled-components'

interface Props {
  block: ImageMessageBlock
}

const ImageBlock: React.FC<Props> = ({ block }) => {
  if (block.status === MessageBlockStatus.PENDING) return <Skeleton.Image active style={{ width: 200, height: 200 }} />
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
            style={{ maxWidth: 500, maxHeight: 'min(500px, 50vh)', padding: 0, borderRadius: 8 }}
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
`
export default React.memo(ImageBlock)
