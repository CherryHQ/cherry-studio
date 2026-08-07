import * as React from 'react'

import { cn } from '../../../lib/utils'
import { ImagePreviewContextMenu } from './image-preview-context-menu'
import { ImagePreviewImage } from './image-preview-image'
import type {
  ImagePreviewAction,
  ImagePreviewActionContext,
  ImagePreviewActionErrorHandler,
  ImagePreviewItem,
  ImagePreviewTransform
} from './types'
import type { ImagePreviewTransformControls } from './use-image-preview-transform'

interface Size {
  height: number
  width: number
}

interface DragState {
  offsetX: number
  offsetY: number
  pointerId: number
  startX: number
  startY: number
}

export interface ImagePreviewViewportProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onError' | 'onLoad'> {
  actionContext?: ImagePreviewActionContext
  actions?: ImagePreviewAction[]
  imageClassName?: string
  item: ImagePreviewItem
  onActionError?: ImagePreviewActionErrorHandler
  onBackdropClick?: () => void
  onError?: React.ReactEventHandler<HTMLImageElement>
  onLoad?: React.ReactEventHandler<HTMLImageElement>
  transformControls: ImagePreviewTransformControls
}

const EMPTY_SIZE: Size = { height: 0, width: 0 }
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const getItemKey = (item: ImagePreviewItem) => `${item.id}\0${item.src}`

const getGeometry = (
  imageSize: Size,
  viewportSize: Size,
  transform: Pick<ImagePreviewTransform, 'rotation' | 'zoom'>
) => {
  if (imageSize.width <= 0 || imageSize.height <= 0 || viewportSize.width <= 0 || viewportSize.height <= 0) {
    return { fitScale: 1, maxOffsetX: 0, maxOffsetY: 0 }
  }

  const swapsDimensions = transform.rotation % 180 !== 0
  const rotatedWidth = swapsDimensions ? imageSize.height : imageSize.width
  const rotatedHeight = swapsDimensions ? imageSize.width : imageSize.height
  const fitScale = Math.min(1, viewportSize.width / rotatedWidth, viewportSize.height / rotatedHeight)
  const renderedWidth = rotatedWidth * fitScale * transform.zoom
  const renderedHeight = rotatedHeight * fitScale * transform.zoom

  return {
    fitScale,
    maxOffsetX: Math.max(0, (renderedWidth - viewportSize.width) / 2),
    maxOffsetY: Math.max(0, (renderedHeight - viewportSize.height) / 2)
  }
}

const clampOffsets = (
  transform: Pick<ImagePreviewTransform, 'offsetX' | 'offsetY' | 'rotation' | 'zoom'>,
  imageSize: Size,
  viewportSize: Size
) => {
  const { maxOffsetX, maxOffsetY } = getGeometry(imageSize, viewportSize, transform)
  return {
    offsetX: clamp(transform.offsetX, -maxOffsetX, maxOffsetX),
    offsetY: clamp(transform.offsetY, -maxOffsetY, maxOffsetY)
  }
}

export function ImagePreviewViewport({
  actionContext,
  actions = [],
  className,
  imageClassName,
  item,
  onActionError,
  onBackdropClick,
  onError,
  onLoad,
  transformControls,
  ...props
}: ImagePreviewViewportProps) {
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef<DragState | null>(null)
  const [isDragging, setIsDragging] = React.useState(false)
  const [viewportSize, setViewportSize] = React.useState<Size>(EMPTY_SIZE)
  const [loadedImage, setLoadedImage] = React.useState<{ itemKey: string; size: Size } | null>(null)
  const itemKey = getItemKey(item)
  const imageSize = loadedImage?.itemKey === itemKey ? loadedImage.size : EMPTY_SIZE
  const { transform, update } = transformControls
  const geometry = getGeometry(imageSize, viewportSize, transform)
  const canPan = geometry.maxOffsetX > 0 || geometry.maxOffsetY > 0
  const isGeometryReady =
    imageSize.width > 0 && imageSize.height > 0 && viewportSize.width > 0 && viewportSize.height > 0

  React.useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const updateSize = () => {
      const rect = viewport.getBoundingClientRect()
      setViewportSize((current) =>
        current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height }
      )
    }

    updateSize()
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(updateSize)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  React.useLayoutEffect(() => {
    const offsets = clampOffsets(transform, imageSize, viewportSize)
    update(offsets)
  }, [imageSize, transform, update, viewportSize])

  const zoomAt = React.useCallback(
    (nextZoom: number, clientX: number, clientY: number) => {
      const viewport = viewportRef.current
      if (!viewport) return
      const rect = viewport.getBoundingClientRect()
      const anchorX = clientX - rect.left - rect.width / 2
      const anchorY = clientY - rect.top - rect.height / 2

      update((current) => {
        const zoom = clamp(nextZoom, transformControls.minZoom, transformControls.maxZoom)
        const ratio = zoom / current.zoom
        const next = {
          ...current,
          offsetX: anchorX - (anchorX - current.offsetX) * ratio,
          offsetY: anchorY - (anchorY - current.offsetY) * ratio,
          zoom
        }
        return { ...next, ...clampOffsets(next, imageSize, viewportSize) }
      })
    },
    [imageSize, transformControls.maxZoom, transformControls.minZoom, update, viewportSize]
  )

  const handleWheel = React.useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      event.preventDefault()
      const nextZoom = transform.zoom * Math.exp(-event.deltaY * 0.002)
      zoomAt(nextZoom, event.clientX, event.clientY)
    },
    [transform.zoom, zoomAt]
  )

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLImageElement>) => {
      event.stopPropagation()
      if (event.button !== 0 || !canPan) return

      dragRef.current = {
        offsetX: transform.offsetX,
        offsetY: transform.offsetY,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      setIsDragging(true)
      event.preventDefault()
    },
    [canPan, transform.offsetX, transform.offsetY]
  )

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLImageElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return

      const next = {
        ...transform,
        offsetX: drag.offsetX + event.clientX - drag.startX,
        offsetY: drag.offsetY + event.clientY - drag.startY
      }
      update(clampOffsets(next, imageSize, viewportSize))
    },
    [imageSize, transform, update, viewportSize]
  )

  const stopDragging = React.useCallback((event: React.PointerEvent<HTMLImageElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
    setIsDragging(false)
  }, [])

  const image = (
    <ImagePreviewImage
      key={itemKey}
      className={cn(
        'max-h-none max-w-none shrink-0',
        canPan && (isDragging ? 'cursor-grabbing transition-none' : 'cursor-grab'),
        imageClassName
      )}
      fitScale={geometry.fitScale}
      item={item}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => {
        event.stopPropagation()
        zoomAt(transform.zoom > transformControls.minZoom ? transformControls.minZoom : 2, event.clientX, event.clientY)
      }}
      onError={onError}
      onLoad={(event) => {
        setLoadedImage({
          itemKey,
          size: {
            height: event.currentTarget.naturalHeight,
            width: event.currentTarget.naturalWidth
          }
        })
        onLoad?.(event)
      }}
      onPointerCancel={stopDragging}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      style={{
        ...(imageSize.width > 0 ? { height: imageSize.height, width: imageSize.width } : {}),
        visibility: isGeometryReady ? 'visible' : 'hidden'
      }}
      transform={transform}
    />
  )

  return (
    <div
      {...props}
      ref={viewportRef}
      className={cn('relative flex h-full w-full touch-none items-center justify-center overflow-hidden', className)}
      data-testid="image-preview-viewport"
      onClick={(event) => {
        if (event.target === event.currentTarget) onBackdropClick?.()
      }}
      onWheel={handleWheel}>
      {actionContext && actions.length > 0 ? (
        <ImagePreviewContextMenu actions={actions} context={actionContext} item={item} onActionError={onActionError}>
          {image}
        </ImagePreviewContextMenu>
      ) : (
        image
      )}
    </div>
  )
}
