import ImageViewer from '@renderer/components/ImageViewer'
import { cn } from '@renderer/utils/style'
import React from 'react'

interface Props {
  images: string[]
  isPending?: boolean
  isSingle?: boolean
  /** Sent attachments read as references, not content: cap them well below the inline size. */
  thumbnail?: boolean
  className?: string
}

const ImageBlock: React.FC<Props> = ({ images, isPending = false, isSingle = false, thumbnail = false, className }) => {
  if (isPending) {
    return <div className="h-50 w-50 animate-pulse rounded-lg bg-muted" />
  }

  if (images.length === 0) {
    return null
  }

  const previewItems = images.map((src, index) => ({ id: `${index}:${src}`, src }))
  const style: React.CSSProperties = thumbnail
    ? { maxWidth: 240, maxHeight: 160, padding: 0, borderRadius: 8 }
    : isSingle
      ? { maxWidth: 500, maxHeight: 'min(500px, 50vh)', padding: 0, borderRadius: 8 }
      : { width: 280, height: 280, objectFit: 'cover', padding: 0, borderRadius: 8 }

  return (
    <div className={cn(isSingle && !thumbnail ? undefined : 'flex max-w-full flex-wrap gap-2.5', className)}>
      {previewItems.map((item) => (
        <ImageViewer
          src={item.src}
          key={item.id}
          className="-outline-offset-1 outline outline-1 outline-black/10 dark:outline-white/10"
          preview={{ items: previewItems }}
          style={style}
        />
      ))}
    </div>
  )
}

export default React.memo(ImageBlock)
