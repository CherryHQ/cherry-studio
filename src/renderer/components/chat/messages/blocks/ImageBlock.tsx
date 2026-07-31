import React from 'react'

import ImageViewer from '@renderer/components/ImageViewer'

interface Props {
  images: string[]
  isPending?: boolean
  isSingle?: boolean
}

const ImageBlock: React.FC<Props> = ({ images, isPending = false, isSingle = false }) => {
  if (isPending) {
    return <div className="h-50 w-50 animate-pulse rounded-lg bg-muted" />
  }

  if (images.length === 0) {
    return null
  }

  const previewItems = images.map((src, index) => ({ id: `${index}:${src}`, src }))

  return (
    <div className={isSingle ? undefined : 'flex max-w-full flex-wrap gap-2.5'}>
      {previewItems.map((item) => (
        <ImageViewer
          src={item.src}
          key={item.id}
          preview={{ items: previewItems }}
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
