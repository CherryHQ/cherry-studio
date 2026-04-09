import ImageViewer from '@renderer/components/ImageViewer'
import { Skeleton } from 'antd'
import React from 'react'
import styled from 'styled-components'

interface Props {
  images: string[]
  isPending?: boolean
  isSingle?: boolean
}

const ImageBlock: React.FC<Props> = ({ images, isPending = false, isSingle = false }) => {
  if (isPending) {
    return <Skeleton.Image active style={{ width: 200, height: 200 }} />
  }

  if (images.length === 0) {
    return null
  }

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
        />
      ))}
    </Container>
  )
}

const Container = styled.div`
  display: block;
`
export default React.memo(ImageBlock)
