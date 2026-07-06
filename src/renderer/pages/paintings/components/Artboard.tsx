import { Button, Tooltip } from '@cherrystudio/ui'
import ImageViewer from '@renderer/components/ImageViewer'
import { ImageDown, ImageUp, RefreshCcw, RotateCcwSquare, RotateCwSquare, ZoomIn, ZoomOut } from 'lucide-react'
import {
  type FC,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

import type { PaintingData } from '../model/types/paintingData'
import { paintingClasses } from '../paintingPrimitives'
import { getPaintingFileUrl } from '../utils/paintingFileUrl'

const DEFAULT_IMAGE_SCALE = 1
const MIN_IMAGE_SCALE = 0.25
const MAX_IMAGE_SCALE = 4
const IMAGE_SCALE_STEP = 0.25
const DEFAULT_IMAGE_OFFSET = { x: 0, y: 0 }

type ImageOffset = typeof DEFAULT_IMAGE_OFFSET

type ImageDragState = {
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

const InlineLoadingState: FC<{ text: ReactNode; onCancel: () => void; cancelLabel: string }> = ({
  text,
  onCancel,
  cancelLabel
}) => {
  const progressLabel = typeof text === 'string' ? text : undefined

  return (
    <div
      className="flex w-full max-w-[360px] flex-col items-center gap-3 rounded-md bg-card px-5 py-4 text-card-foreground"
      role="status"
      aria-live="polite">
      <div className="text-center font-medium text-[13px] text-foreground leading-5">{text}</div>
      <div
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={progressLabel}>
        <span className="animation-migration-backup-progress-indeterminate absolute inset-y-0 left-0 w-1/3 min-w-20 rounded-full bg-linear-to-r from-primary/0 via-primary to-primary/0" />
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onCancel} className="min-w-20">
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
    <Tooltip content={label} placement="right" delay={800}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        aria-label={label}
        onClick={onClick}
        className={paintingClasses.toolbarButton}>
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
  // custom-protocol handler is registered and paintings consume `FileEntry` directly.
  const currentImageUrl = currentFile ? getPaintingFileUrl(currentFile) : undefined
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

  const rotateImageRight = useCallback(() => {
    setImageRotation((rotation) => rotation + 90)
  }, [])

  const rotateImageLeft = useCallback(() => {
    setImageRotation((rotation) => rotation - 90)
  }, [])

  const resetImageTransform = useCallback(() => {
    imageDragRef.current = null
    setIsDraggingImage(false)
    setImageScale(DEFAULT_IMAGE_SCALE)
    setImageRotation(0)
    setImageOffset(DEFAULT_IMAGE_OFFSET)
  }, [])

  const onImagePointerDown = useCallback((event: PointerEvent<HTMLImageElement>) => {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    imageDragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY
    }
    setIsDraggingImage(true)
  }, [])

  const onImagePointerMove = useCallback((event: PointerEvent<HTMLImageElement>) => {
    const dragState = imageDragRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return
    }

    event.preventDefault()
    const deltaX = event.clientX - dragState.x
    const deltaY = event.clientY - dragState.y
    dragState.x = event.clientX
    dragState.y = event.clientY
    setImageOffset((offset) => ({ x: offset.x + deltaX, y: offset.y + deltaY }))
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
    resetImageTransform()
  }, [painting.id, resetImageTransform])

  useLayoutEffect(() => {
    resetImageTransform()
  }, [currentFile?.id, resetImageTransform])

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col p-2">
      <div
        className={`relative flex min-h-0 flex-1 flex-col items-center justify-center transition-opacity ${isLoading ? 'opacity-70' : 'opacity-100'}`}>
        {painting.files.length > 0 && currentImageUrl ? (
          <div className="relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden">
            <ImageViewer
              alt=""
              className={`max-h-full max-w-full select-none rounded-md bg-secondary object-contain ${
                isDraggingImage ? 'cursor-grabbing transition-none' : 'cursor-grab transition-transform duration-150'
              }`}
              draggable={false}
              onPointerCancel={stopImageDrag}
              onPointerDown={onImagePointerDown}
              onPointerMove={onImagePointerMove}
              onPointerUp={stopImageDrag}
              preview={false}
              src={currentImageUrl}
              style={{
                transform: `translate(${imageOffset.x}px, ${imageOffset.y}px) scale(${imageScale}) rotate(${imageRotation}deg)`,
                touchAction: 'none'
              }}
            />
            <div
              className={`${paintingClasses.toolbarWrap} ${paintingClasses.toolbarRail}`}
              role="toolbar"
              aria-label={t('preview.label')}>
              {painting.files.length > 1 && (
                <>
                  <ArtboardToolButton label={t('preview.previous')} onClick={onPrevImage}>
                    <ImageUp className="size-[18px]" />
                  </ArtboardToolButton>
                  <ArtboardToolButton label={t('preview.next')} onClick={onNextImage}>
                    <ImageDown className="size-[18px]" />
                  </ArtboardToolButton>
                  <span className="my-0.5 h-px w-4 bg-border-subtle" aria-hidden />
                </>
              )}
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
              <ArtboardToolButton label={t('preview.rotate_left')} onClick={rotateImageLeft}>
                <RotateCcwSquare className="size-4" />
              </ArtboardToolButton>
              <ArtboardToolButton label={t('preview.rotate_right')} onClick={rotateImageRight}>
                <RotateCwSquare className="size-4" />
              </ArtboardToolButton>
              <ArtboardToolButton label={t('preview.reset')} onClick={resetImageTransform}>
                <RefreshCcw className="size-4" />
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
          <div className="-translate-y-1/2 absolute inset-x-4 top-1/2 z-30 flex justify-center">
            <InlineLoadingState text={loadingText} onCancel={onCancel} cancelLabel={t('common.cancel')} />
          </div>
        )}
      </div>
    </div>
  )
}

export default Artboard
