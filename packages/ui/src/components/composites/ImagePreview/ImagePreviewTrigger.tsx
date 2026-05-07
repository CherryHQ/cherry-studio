import * as React from 'react'

import { ImagePreviewDialog, type ImagePreviewDialogProps } from './ImagePreviewDialog'
import type { ImagePreviewItem } from './types'

export interface ImagePreviewTriggerProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  dialogProps?: Omit<ImagePreviewDialogProps, 'activeIndex' | 'items' | 'onActiveIndexChange' | 'onOpenChange' | 'open'>
  item: ImagePreviewItem
  items?: ImagePreviewItem[]
  preview?: boolean
}

export function ImagePreviewTrigger({
  alt,
  dialogProps,
  item,
  items,
  onClick,
  preview = true,
  ...props
}: ImagePreviewTriggerProps) {
  const [open, setOpen] = React.useState(false)
  const previewItems = items ?? [item]
  const initialIndex = Math.max(
    0,
    previewItems.findIndex((previewItem) => previewItem.id === item.id)
  )
  const [activeIndex, setActiveIndex] = React.useState(initialIndex)

  React.useEffect(() => {
    setActiveIndex(initialIndex)
  }, [initialIndex])

  return (
    <>
      <img
        alt={alt ?? item.alt ?? item.title ?? ''}
        onClick={(event) => {
          onClick?.(event)
          if (!event.defaultPrevented && preview) {
            setActiveIndex(initialIndex)
            setOpen(true)
          }
        }}
        src={item.src}
        {...props}
      />
      {preview && (
        <ImagePreviewDialog
          {...dialogProps}
          activeIndex={activeIndex}
          items={previewItems}
          onActiveIndexChange={setActiveIndex}
          onOpenChange={setOpen}
          open={open}
        />
      )}
    </>
  )
}
