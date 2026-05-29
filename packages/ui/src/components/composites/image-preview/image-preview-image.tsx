import type * as React from 'react'

import { cn } from '../../../lib/utils'
import type { ImagePreviewItem, ImagePreviewTransform } from './types'

export interface ImagePreviewImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  item: ImagePreviewItem
  transform: ImagePreviewTransform
}

export function ImagePreviewImage({ className, item, style, transform, ...props }: ImagePreviewImageProps) {
  const transformValue = [
    `scale(${transform.scale})`,
    `rotate(${transform.rotate}deg)`,
    `scaleX(${transform.flipX ? -1 : 1})`,
    `scaleY(${transform.flipY ? -1 : 1})`
  ].join(' ')

  return (
    <img
      alt={item.alt ?? item.title ?? ''}
      className={cn('max-h-full max-w-full select-none object-contain transition-transform duration-150', className)}
      draggable={false}
      src={item.src}
      style={{ ...style, transform: transformValue }}
      {...props}
    />
  )
}
