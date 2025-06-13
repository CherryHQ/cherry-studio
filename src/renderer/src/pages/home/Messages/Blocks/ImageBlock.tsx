import SvgSpinners180Ring from '@renderer/components/Icons/SvgSpinners180Ring'
import ImageViewer from '@renderer/components/ImageViewer'
import { type ImageMessageBlock, MessageBlockStatus } from '@renderer/types/newMessage'
import React from 'react'
import styled from 'styled-components'

interface Props {
  block: ImageMessageBlock
}

const ImageBlock: React.FC<Props> = ({ block }) => {
  if (block.status === MessageBlockStatus.STREAMING || block.status === MessageBlockStatus.PROCESSING)
    return (
      <SpinnerWrapper>
        <SvgSpinners180Ring />
      </SpinnerWrapper>
    )
  if (block.status === MessageBlockStatus.SUCCESS) {
    const images = block.metadata?.generateImageResponse?.images?.length
      ? block.metadata?.generateImageResponse?.images
      : block?.file?.path
        ? [`file://${block?.file?.path}`]
        : []
    return (
      <Container style={{ marginBottom: 8 }}>
        {images.map((src, index) => (
          <ImageViewer
            src={src}
            key={`image-${index}`}
            style={{ maxWidth: 500, maxHeight: 500, padding: 5, borderRadius: 8 }}
          />
        ))}
      </Container>
    )
  } else {
    return <></>
  }
}
const Container = styled.div`
  display: flex;
  flex-direction: row;
  gap: 10px;
  margin-top: 8px;
`

const SpinnerWrapper = styled.div`
  display: flex;
  justify-content: flex-start;
  align-items: center;
`

export default React.memo(ImageBlock)
