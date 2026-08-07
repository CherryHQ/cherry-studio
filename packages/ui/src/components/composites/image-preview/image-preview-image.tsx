import type * as React from 'react'

import { cn } from '../../../lib/utils'
import type { ImagePreviewItem, ImagePreviewTransform } from './types'

export interface ImagePreviewImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  fitScale?: number
  item: ImagePreviewItem
  transform: ImagePreviewTransform
}

export function ImagePreviewImage({
  className,
  fitScale = 1,
  item,
  style,
  transform,
  ...props
}: ImagePreviewImageProps) {
  const transformValue = [
    `translate3d(${transform.offsetX}px, ${transform.offsetY}px, 0)`,
    `rotate(${transform.rotation}deg)`,
    `scale(${fitScale * transform.zoom})`,
    `scaleX(${transform.flipX ? -1 : 1})`,
    `scaleY(${transform.flipY ? -1 : 1})`
  ].join(' ')

  return (
    <img
      alt={item.alt ?? item.title ?? ''}
      className={cn('block max-h-full max-w-full select-none object-contain', className)}
      draggable={false}
      src={item.src}
      style={{ ...style, transform: transformValue, transformOrigin: 'center', willChange: 'transform' }}
      {...props}
    />
  )
}
