import ImageViewer from '@renderer/components/ImageViewer'
import type { ImageMessageBlock } from '@renderer/types/newMessage'
import type { FC } from 'react'

interface Props {
  block: ImageMessageBlock
}

const MessageImage: FC<Props> = ({ block }) => {
  const images = block.metadata?.generateImageResponse?.images?.length
    ? block.metadata?.generateImageResponse?.images
    : block?.file?.path
      ? [`file://${block?.file?.path}`]
      : []

  if (images.length === 0) {
    return null
  }

  return (
    <div className="mt-2 mb-2 flex flex-row gap-2.5">
      {images.map((image, index) => (
        <ImageViewer
          src={image}
          key={`image-${index}`}
          style={{ maxWidth: 500, maxHeight: 500 }}
          preview={{ mask: false }}
          enablePreviewTools
          enableContextMenuTools
        />
      ))}
    </div>
  )
}

export default MessageImage
