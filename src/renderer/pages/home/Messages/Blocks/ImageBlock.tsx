import ImageViewer from '@renderer/components/ImageViewer'
import React from 'react'

interface Props {
  images: string[]
  isPending?: boolean
  isSingle?: boolean
}

const ImageBlock: React.FC<Props> = ({ images, isPending = false, isSingle = false }) => {
  if (isPending) {
    return <div className="h-[200px] w-[200px] animate-pulse rounded-lg bg-(--color-background-soft)" />
  }

  if (images.length === 0) {
    return null
  }

  return (
    <div>
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
    </div>
  )
}

export default React.memo(ImageBlock)
