import { ImagePlus } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import ImageViewer from '@renderer/components/ImageViewer'
import { cn } from '@renderer/utils/style'

export type ImageBlockItem = string | { id: string; src: string }

interface Props {
  images: ImageBlockItem[]
  isPending?: boolean
  isSingle?: boolean
  /** Sent attachments read as references, not content: cap them well below the inline size. */
  thumbnail?: boolean
  className?: string
  onUseAsReference?: (index: number) => void | Promise<void>
}

const ImageBlock: React.FC<Props> = ({
  images,
  isPending = false,
  isSingle = false,
  thumbnail = false,
  className,
  onUseAsReference
}) => {
  const { t } = useTranslation()

  if (isPending) {
    return <div className="h-50 w-50 animate-pulse rounded-lg bg-muted" />
  }

  if (images.length === 0) {
    return null
  }

  const previewItems = images.map((item, index) =>
    typeof item === 'string' ? { id: `${index}:${item}`, src: item } : item
  )
  const style: React.CSSProperties = thumbnail
    ? { maxWidth: 240, maxHeight: 160, padding: 0, borderRadius: 8 }
    : isSingle
      ? { maxWidth: 500, maxHeight: 'min(500px, 50vh)', padding: 0, borderRadius: 8 }
      : { width: 280, height: 280, objectFit: 'cover', padding: 0, borderRadius: 8 }

  return (
    <div className={cn(isSingle && !thumbnail ? undefined : 'flex max-w-full flex-wrap gap-2.5', className)}>
      {previewItems.map((item, index) => (
        <div className={onUseAsReference ? 'flex flex-col items-start gap-1' : undefined} key={item.id}>
          <ImageViewer
            src={item.src}
            className="-outline-offset-1 outline outline-1 outline-black/10 dark:outline-white/10"
            preview={{ items: previewItems }}
            style={style}
          />
          {onUseAsReference && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void onUseAsReference(index)}
              aria-label={t('chat.input.use_as_reference')}>
              <ImagePlus />
              {t('chat.input.use_as_reference')}
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}

export default React.memo(ImageBlock)
