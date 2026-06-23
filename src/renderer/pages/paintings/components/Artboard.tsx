import { Button, Tooltip } from '@cherrystudio/ui'
import FileManager from '@renderer/services/FileManager'
import { motion } from 'framer-motion'
import { RotateCw, Undo2, ZoomIn, ZoomOut } from 'lucide-react'
import { type FC, type PointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { PaintingData } from '../model/types/paintingData'

const DEFAULT_IMAGE_SCALE = 1
const MIN_IMAGE_SCALE = 0.25
const MAX_IMAGE_SCALE = 4
const IMAGE_SCALE_STEP = 0.25
const DEFAULT_IMAGE_OFFSET = { x: 0, y: 0 }

type ImageOffset = typeof DEFAULT_IMAGE_OFFSET

type ImageDragState = {
  offset: ImageOffset
  pointerId: number
  x: number
  y: number
}

export interface ArtboardProps {
  painting: PaintingData
  isLoading: boolean
  onCancel: () => void
  imageCover?: ReactNode
  loadText?: ReactNode
}

const LoadingStateCard: FC<{ text: ReactNode; onCancel: () => void; cancelLabel: string }> = ({
  text,
  onCancel,
  cancelLabel
}) => {
  return (
    <div className="flex min-w-56 flex-col items-center gap-4 rounded-[18px] border border-border-subtle bg-card/96 px-10 py-10 shadow-2xl backdrop-blur-sm">
      <div className="relative h-12 w-12">
        <motion.div
          className="absolute inset-0 rounded-full border-2 border-border"
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY, ease: 'linear' }}
        />
        <motion.div
          className="absolute inset-1 rounded-full border-2 border-primary border-r-transparent border-b-transparent"
          animate={{ rotate: -360 }}
          transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY, ease: 'linear' }}
        />
      </div>
      <div className="text-center font-medium text-[13px] text-foreground/85">{text}</div>
      <Button variant="outline" size="sm" onClick={onCancel} className="mt-1 min-w-20">
        {cancelLabel}
      </Button>
    </div>
  )
}

const ArtboardToolButton: FC<{
  children: ReactNode
  disabled?: boolean
  label: string
  onClick: () => void
}> = ({ children, disabled, label, onClick }) => {
  return (
    <Tooltip content={label} delay={800}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        aria-label={label}
        onClick={onClick}
        className="rounded-full text-muted-foreground hover:bg-muted/55 hover:text-foreground">
        {children}
      </Button>
    </Tooltip>
  )
}

const Artboard: FC<ArtboardProps> = ({ painting, isLoading, onCancel, imageCover, loadText }) => {
  const { t } = useTranslation()
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [imageScale, setImageScale] = useState(DEFAULT_IMAGE_SCALE)
  const [imageRotation, setImageRotation] = useState(0)
  const [imageOffset, setImageOffset] = useState<ImageOffset>(DEFAULT_IMAGE_OFFSET)
  const [isDraggingImage, setIsDraggingImage] = useState(false)
  const imageDragRef = useRef<ImageDragState | null>(null)
  const displayedImageIndex = painting.files.length > 0 ? Math.min(currentImageIndex, painting.files.length - 1) : 0
  const currentFile = painting.files[displayedImageIndex]
  // TODO(#15353): swap for `cherrystudio://file/internal/${id}.${ext}` once the
  // custom-protocol handler is registered. Drops the `FileManager.getFileUrl`
  // dependency and lets us stop synthesizing `FileMetadata.name = id+ext` in
  // `fileEntryAdapter`.
  const currentImageUrl = currentFile ? FileManager.getFileUrl(currentFile) : ''
  const loadingText = loadText || t('paintings.generating')

  const onPrevImage = useCallback(() => {
    setCurrentImageIndex((index) => (index > 0 ? index - 1 : Math.max(0, painting.files.length - 1)))
  }, [painting.files.length])

  const onNextImage = useCallback(() => {
    setCurrentImageIndex((index) => (painting.files.length > 0 ? (index + 1) % painting.files.length : 0))
  }, [painting.files.length])

  const zoomIn = useCallback(() => {
    setImageScale((scale) => Math.min(MAX_IMAGE_SCALE, scale + IMAGE_SCALE_STEP))
  }, [])

  const zoomOut = useCallback(() => {
    setImageScale((scale) => Math.max(MIN_IMAGE_SCALE, scale - IMAGE_SCALE_STEP))
  }, [])

  const rotateImage = useCallback(() => {
    setImageRotation((rotation) => (rotation + 90) % 360)
  }, [])

  const resetImageTransform = useCallback(() => {
    imageDragRef.current = null
    setIsDraggingImage(false)
    setImageScale(DEFAULT_IMAGE_SCALE)
    setImageRotation(0)
    setImageOffset(DEFAULT_IMAGE_OFFSET)
  }, [])

  const onImagePointerDown = useCallback(
    (event: PointerEvent<HTMLImageElement>) => {
      if (event.button !== 0) {
        return
      }

      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      imageDragRef.current = {
        offset: imageOffset,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY
      }
      setIsDraggingImage(true)
    },
    [imageOffset]
  )

  const onImagePointerMove = useCallback((event: PointerEvent<HTMLImageElement>) => {
    const dragState = imageDragRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return
    }

    event.preventDefault()
    setImageOffset({
      x: dragState.offset.x + event.clientX - dragState.x,
      y: dragState.offset.y + event.clientY - dragState.y
    })
  }, [])

  const stopImageDrag = useCallback((event: PointerEvent<HTMLImageElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (imageDragRef.current?.pointerId === event.pointerId) {
      imageDragRef.current = null
      setIsDraggingImage(false)
    }
  }, [])

  useEffect(() => {
    setCurrentImageIndex(0)
  }, [painting.id])

  useEffect(() => {
    resetImageTransform()
  }, [currentFile?.id, resetImageTransform])

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col p-2">
      <div
        className={`relative flex min-h-0 flex-1 flex-col items-center justify-center transition-opacity ${isLoading ? 'opacity-70' : 'opacity-100'}`}>
        {painting.files.length > 0 ? (
          <div className="relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden">
            {painting.files.length > 1 && (
              <Button
                size="icon-sm"
                variant="outline"
                onClick={onPrevImage}
                aria-label={t('preview.previous')}
                className="-translate-y-1/2 absolute top-1/2 left-2.5 z-20 opacity-80 hover:opacity-100">
                ←
              </Button>
            )}
            <img
              alt=""
              className={`max-h-full max-w-full select-none rounded-md bg-secondary object-contain ${
                isDraggingImage ? 'cursor-grabbing transition-none' : 'cursor-grab transition-transform duration-150'
              }`}
              draggable={false}
              onPointerCancel={stopImageDrag}
              onPointerDown={onImagePointerDown}
              onPointerMove={onImagePointerMove}
              onPointerUp={stopImageDrag}
              src={currentImageUrl}
              style={{
                transform: `translate(${imageOffset.x}px, ${imageOffset.y}px) scale(${imageScale}) rotate(${imageRotation}deg)`,
                touchAction: 'none'
              }}
            />
            {painting.files.length > 1 && (
              <Button
                size="icon-sm"
                variant="outline"
                onClick={onNextImage}
                aria-label={t('preview.next')}
                className="-translate-y-1/2 absolute top-1/2 right-2.5 z-20 opacity-80 hover:opacity-100">
                →
              </Button>
            )}
            <div
              className="absolute right-2.5 bottom-2.5 z-20 flex items-center gap-1 rounded-full border border-border-muted bg-background/90 p-1 shadow-md backdrop-blur-xl"
              role="toolbar"
              aria-label={t('preview.label')}>
              <ArtboardToolButton
                label={t('preview.zoom_out')}
                disabled={imageScale <= MIN_IMAGE_SCALE}
                onClick={zoomOut}>
                <ZoomOut className="size-4" />
              </ArtboardToolButton>
              <ArtboardToolButton
                label={t('preview.zoom_in')}
                disabled={imageScale >= MAX_IMAGE_SCALE}
                onClick={zoomIn}>
                <ZoomIn className="size-4" />
              </ArtboardToolButton>
              <ArtboardToolButton label={t('preview.rotate_right')} onClick={rotateImage}>
                <RotateCw className="size-4" />
              </ArtboardToolButton>
              <ArtboardToolButton label={t('preview.reset')} onClick={resetImageTransform}>
                <Undo2 className="size-4" />
              </ArtboardToolButton>
            </div>
            <div className="-translate-x-1/2 absolute bottom-2.5 left-1/2 rounded-full bg-foreground/60 px-2 py-1 text-background text-xs">
              {displayedImageIndex + 1} / {painting.files.length}
            </div>
          </div>
        ) : imageCover ? (
          imageCover
        ) : null}

        {isLoading && (
          <div className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 z-30">
            <LoadingStateCard text={loadingText} onCancel={onCancel} cancelLabel={t('common.cancel')} />
          </div>
        )}
      </div>
    </div>
  )
}

export default Artboard
