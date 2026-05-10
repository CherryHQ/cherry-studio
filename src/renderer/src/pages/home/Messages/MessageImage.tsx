import ImageViewer from '@renderer/components/ImageViewer'
import type { ImageMessageBlock } from '@renderer/types/newMessage'
import type { FC } from 'react'

interface Props {
  block: ImageMessageBlock
}

const MessageImage: FC<Props> = ({ block }) => {
  const generatedImages = block.metadata?.generateImageResponse?.images
  const images = generatedImages?.length ? generatedImages : block?.file?.path ? [`file://${block?.file?.path}`] : []

  if (images.length === 0) {
    return null
  }

  const previewItems = images.map((image, index) => ({
    id: `image-${index}`,
    src: image
  }))

  return (
    <div style={{ display: 'flex', flexDirection: 'row', gap: 10, marginBottom: 8, marginTop: 8 }}>
      {images.map((image, index) => (
        <ImageViewer
          key={`image-${index}`}
          preview={{
            defaultActiveIndex: index,
            items: previewItems
          }}
          src={image}
          style={{ borderRadius: 8, maxHeight: 500, maxWidth: 500, padding: 5 }}
        />
      ))}
    </div>
  )
}

export default MessageImage
