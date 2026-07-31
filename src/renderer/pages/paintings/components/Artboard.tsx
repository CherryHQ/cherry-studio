import { Button, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import CopyButton from '@renderer/components/CopyButton'
import ImageViewer from '@renderer/components/ImageViewer'
import { ImageDown, ImageUp, Palette, RefreshCcw, RotateCcwSquare, RotateCwSquare, ZoomIn, ZoomOut } from 'lucide-react'
import {
  type FC,
  type PointerEvent,
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

import { usePaintingSizeInfo } from '../hooks/usePaintingSizeInfo'
import type { PaintingData } from '../model/types/paintingData'
import { paintingClasses } from '../paintingPrimitives'
import { computeImageNaturalSize } from '../utils/computeImageNaturalSize'
import { getPaintingFileUrl } from '../utils/paintingFileUrl'
import PaintingImageSkeleton from './PaintingImageSkeleton'

const logger = loggerService.withContext('paintings/Artboard')

const DEFAULT_IMAGE_SCALE = 1
const MIN_IMAGE_SCALE = 0.25
const MAX_IMAGE_SCALE = 4
const IMAGE_SCALE_STEP = 0.25
const DEFAULT_IMAGE_OFFSET = { x: 0, y: 0 }
const PROMPT_POPOVER_CLOSE_DELAY = 150

type ImageOffset = typeof DEFAULT_IMAGE_OFFSET
type PromptPopoverOpenReason = 'keyboard' | 'pointer'

type ImageDragState = {
  pointerId: number
  x: number
  y: number
}

type RevealState =
  // Loading finished before any file exists (e.g. still generating on another
  // painting) — waiting for a file to arrive before starting the reveal.
  | { status: 'awaiting' }
  // A file exists; its natural size is still being decoded.
  | { status: 'pending'; fileId: string; imageUrl: string }
  // The natural size has resolved — enough to relock the box and drive the reveal.
  | { status: 'ready'; fileId: string; imageUrl: string; naturalWidth: number; naturalHeight: number }

export interface ArtboardProps {
  painting: PaintingData
  isLoading: boolean
  imageCover?: ReactNode
}

/**
 * Prompt + size strip. Rendered as a flex-col sibling directly above the
 * skeleton/image box (see call sites) so it stretches to match that box's
 * width rather than the full artboard.
 */
const ArtboardPromptBar: FC<{ prompt: string; sizeLabel?: string }> = ({ prompt, sizeLabel }) => {
  const { t } = useTranslation()
  const [isPromptPopoverOpen, setPromptPopoverOpen] = useState(false)
  const promptPopoverCloseTimerRef = useRef<number | null>(null)
  const promptPopoverTriggerRef = useRef<HTMLButtonElement | null>(null)
  const promptPopoverContentRef = useRef<HTMLDivElement | null>(null)
  const promptPopoverOpenReasonRef = useRef<PromptPopoverOpenReason>('pointer')

  const cancelPromptPopoverClose = useCallback(() => {
    if (promptPopoverCloseTimerRef.current === null) return
    window.clearTimeout(promptPopoverCloseTimerRef.current)
    promptPopoverCloseTimerRef.current = null
  }, [])

  const openPromptPopover = useCallback(
    (reason: PromptPopoverOpenReason) => {
      cancelPromptPopoverClose()
      promptPopoverOpenReasonRef.current = reason
      setPromptPopoverOpen(true)
    },
    [cancelPromptPopoverClose]
  )

  const openPromptPopoverFromPointer = useCallback(() => {
    cancelPromptPopoverClose()
    if (isPromptPopoverOpen) return
    promptPopoverOpenReasonRef.current = 'pointer'
    setPromptPopoverOpen(true)
  }, [cancelPromptPopoverClose, isPromptPopoverOpen])

  const schedulePromptPopoverClose = useCallback(() => {
    cancelPromptPopoverClose()
    promptPopoverCloseTimerRef.current = window.setTimeout(() => {
      promptPopoverCloseTimerRef.current = null
      const focusedElement = document.activeElement
      if (
        promptPopoverTriggerRef.current?.contains(focusedElement) ||
        promptPopoverContentRef.current?.contains(focusedElement)
      ) {
        return
      }
      setPromptPopoverOpen(false)
    }, PROMPT_POPOVER_CLOSE_DELAY)
  }, [cancelPromptPopoverClose])

  useEffect(() => cancelPromptPopoverClose, [cancelPromptPopoverClose])

  return (
    <div className="mb-2 flex w-full min-w-0 items-center justify-between gap-2 text-muted-foreground text-xs">
      <div className="min-w-0 max-w-xs flex-1 overflow-hidden">
        <Popover
          open={isPromptPopoverOpen}
          onOpenChange={(open) => {
            cancelPromptPopoverClose()
            if (open && promptPopoverOpenReasonRef.current !== 'keyboard') {
              promptPopoverOpenReasonRef.current = 'pointer'
            }
            setPromptPopoverOpen(open)
          }}>
          <PopoverTrigger asChild>
            <button
              ref={promptPopoverTriggerRef}
              type="button"
              onPointerEnter={(event) => {
                if (event.pointerType !== 'touch') openPromptPopoverFromPointer()
              }}
              onPointerLeave={(event) => {
                if (event.pointerType !== 'touch') schedulePromptPopoverClose()
              }}
              onBlur={schedulePromptPopoverClose}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                event.stopPropagation()
                openPromptPopover('keyboard')
              }}
              className="flex w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-sm text-left text-inherit outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Palette className="size-3.5 shrink-0" aria-hidden />
              {/* CSS `truncate` clips to the available width responsively — the full
                  prompt stays in the DOM (and in the popover) instead of a fixed-length
                  JS slice that shows the same ~10 chars on a wide artboard. */}
              <span className="truncate">{prompt}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            ref={promptPopoverContentRef}
            side="bottom"
            sideOffset={2}
            onPointerEnter={(event) => {
              if (event.pointerType !== 'touch') openPromptPopoverFromPointer()
            }}
            onPointerLeave={(event) => {
              if (event.pointerType !== 'touch') schedulePromptPopoverClose()
            }}
            onFocusCapture={cancelPromptPopoverClose}
            onBlurCapture={schedulePromptPopoverClose}
            onOpenAutoFocus={(event) => {
              if (promptPopoverOpenReasonRef.current !== 'keyboard') {
                event.preventDefault()
              }
            }}
            onCloseAutoFocus={(event) => {
              if (promptPopoverOpenReasonRef.current !== 'keyboard') {
                event.preventDefault()
              }
            }}
            role="dialog"
            aria-label={t('common.prompt')}
            className="max-h-80 w-fit max-w-md overflow-y-auto rounded-md border-0 bg-neutral-900 p-2 text-neutral-50 text-xs leading-relaxed shadow-md">
            <CopyButton
              textToCopy={prompt}
              aria-label={t('common.copy')}
              successFeedback="icon"
              size={14}
              color="inherit"
              hoverColor="inherit"
              className="float-right ml-0.5 size-5 justify-center rounded-md text-neutral-50 hover:bg-neutral-50/10 hover:text-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-50/70 [&_svg]:stroke-neutral-50! [&_svg]:text-neutral-50!"
            />
            <span className="select-text whitespace-pre-wrap break-words">{prompt}</span>
          </PopoverContent>
        </Popover>
      </div>
      {sizeLabel && <span className="shrink-0">{sizeLabel}</span>}
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

const Artboard: FC<ArtboardProps> = ({ painting, isLoading, imageCover }) => {
  const { t } = useTranslation()
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [imageScale, setImageScale] = useState(DEFAULT_IMAGE_SCALE)
  const [imageRotation, setImageRotation] = useState(0)
  const [imageOffset, setImageOffset] = useState<ImageOffset>(DEFAULT_IMAGE_OFFSET)
  const [isDraggingImage, setIsDraggingImage] = useState(false)
  const [revealState, setRevealState] = useState<RevealState | null>(null)
  const [viewerContainer, setViewerContainer] = useState<{ width: number; height: number } | null>(null)
  const [displayedNaturalSize, setDisplayedNaturalSize] = useState<{ width: number; height: number } | null>(null)
  const [promptBarHeight, setPromptBarHeight] = useState(0)
  const imageDragRef = useRef<ImageDragState | null>(null)
  const awaitingRevealRef = useRef(false)
  const previousLoadingRef = useRef(isLoading)
  const paintingIdRef = useRef(painting.id)
  const viewerResizeObserverRef = useRef<ResizeObserver | null>(null)
  const promptBarResizeObserverRef = useRef<ResizeObserver | null>(null)
  const displayedImageIndex = painting.files.length > 0 ? Math.min(currentImageIndex, painting.files.length - 1) : 0
  const currentFile = painting.files[displayedImageIndex]
  const { sizeLabel } = usePaintingSizeInfo(painting)
  // TODO(#15353): swap for `cherrystudio://file/internal/${id}.${ext}` once the
  // custom-protocol handler is registered and paintings consume `FileEntry` directly.
  const currentImageUrl = currentFile ? getPaintingFileUrl(currentFile) : undefined

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

  // Explicit contain-fit box for the idle (already-generated) image, mirroring
  // PaintingImageSkeleton's lockedSize math. CSS auto-sizing a flex-col wrapper around
  // the image can't be trusted here — ImageViewer nests the `<img>` behind a
  // context-menu wrapper that breaks intrinsic-size propagation, leaving the
  // wrapper (and the prompt bar stretched to it) wider than the rendered photo.
  // Measuring explicitly is what lets the prompt bar match the image's real edges.
  const onDisplayedImageLoad = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget
    if (naturalWidth > 0 && naturalHeight > 0) {
      setDisplayedNaturalSize({ width: naturalWidth, height: naturalHeight })
    }
  }, [])

  // A plain ref + mount-only effect would only ever attach once, when Artboard
  // itself first mounts — but this wrapper only exists in the DOM once the idle
  // (already-generated) branch renders, which usually happens later (after a
  // generation completes) than Artboard's own mount. A callback ref re-attaches
  // the observer every time the branch swaps this node in, not just the first time.
  const setViewerContainerRef = useCallback((el: HTMLDivElement | null) => {
    viewerResizeObserverRef.current?.disconnect()
    viewerResizeObserverRef.current = null
    if (!el) return
    const measure = () => setViewerContainer({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    viewerResizeObserverRef.current = observer
  }, [])

  // `promptBar` renders in the fixed layout wrapper above the transformed image,
  // so its own rendered height has to come out of the space
  // `displayedImageBoxSize` treats as available — otherwise bar + image
  // together can exceed `viewerContainer` and the image gets clipped instead
  // of contain-fitting alongside the bar.
  const setPromptBarRef = useCallback((el: HTMLDivElement | null) => {
    promptBarResizeObserverRef.current?.disconnect()
    promptBarResizeObserverRef.current = null
    if (!el) {
      setPromptBarHeight(0)
      return
    }
    const measure = () => setPromptBarHeight(el.clientHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    promptBarResizeObserverRef.current = observer
  }, [])

  useEffect(() => {
    setDisplayedNaturalSize(null)
  }, [currentFile?.id])

  const displayedImageBoxSize = (() => {
    if (!displayedNaturalSize || !viewerContainer || viewerContainer.width <= 0) {
      return null
    }
    const availableHeight = Math.max(0, viewerContainer.height - promptBarHeight)
    if (availableHeight <= 0) {
      return null
    }
    const scale = Math.min(
      1,
      viewerContainer.width / displayedNaturalSize.width,
      availableHeight / displayedNaturalSize.height
    )
    return { width: displayedNaturalSize.width * scale, height: displayedNaturalSize.height * scale }
  })()

  useEffect(() => {
    setCurrentImageIndex(0)
    resetImageTransform()
  }, [painting.id, resetImageTransform])

  useLayoutEffect(() => {
    resetImageTransform()
  }, [currentFile?.id, resetImageTransform])

  useLayoutEffect(() => {
    // A new painting starts with a clean reveal machine. `revealState` and the
    // loading/awaiting refs live across painting switches (Artboard is not
    // remounted per painting), so without this reset the previous painting's
    // in-flight reveal leaks in — stranding a file-less painting in a permanent
    // fake "generating" skeleton, or replaying a reveal over an already-generated
    // one. `wasLoading` is forced to this painting's own `isLoading` on a switch
    // so a not-loading new painting never inherits the previous one's loading.
    const paintingChanged = paintingIdRef.current !== painting.id
    paintingIdRef.current = painting.id
    if (paintingChanged) {
      awaitingRevealRef.current = false
      setRevealState(null)
    }

    const wasLoading = paintingChanged ? isLoading : previousLoadingRef.current
    previousLoadingRef.current = isLoading

    if (isLoading) {
      awaitingRevealRef.current = false
      setRevealState(null)
      return
    }

    const shouldStartReveal = wasLoading || awaitingRevealRef.current

    if (!shouldStartReveal) {
      setRevealState((state) =>
        state && state.status !== 'awaiting' && (state.fileId !== currentFile?.id || state.imageUrl !== currentImageUrl)
          ? null
          : state
      )
      return
    }

    if (!currentFile || !currentImageUrl) {
      // A canceled or failed generation never produces a file — without this,
      // stopping here would leave `revealState` stuck at `{ status: 'awaiting' }`
      // forever, since none of this effect's deps change again to escape it.
      if (painting.generationStatus === 'canceled' || painting.generationStatus === 'failed') {
        awaitingRevealRef.current = false
        setRevealState(null)
        return
      }
      awaitingRevealRef.current = true
      setRevealState((state) => (state?.status === 'awaiting' ? state : { status: 'awaiting' }))
      return
    }

    let active = true
    const target = { fileId: currentFile.id, imageUrl: currentImageUrl }
    awaitingRevealRef.current = false
    setRevealState({ ...target, status: 'pending' })

    void computeImageNaturalSize(currentImageUrl)
      .then((result) => {
        if (!active) {
          return
        }

        if (!result) {
          setRevealState(null)
          return
        }

        setRevealState({
          ...target,
          naturalWidth: result.naturalWidth,
          naturalHeight: result.naturalHeight,
          status: 'ready'
        })
      })
      .catch((error) => {
        logger.warn('Failed to prepare painting image reveal', { error })
        if (active) {
          setRevealState(null)
        }
      })

    return () => {
      active = false
    }
  }, [painting.id, currentFile, currentImageUrl, isLoading, painting.generationStatus])

  const activeReveal = (() => {
    if (isLoading || !revealState) {
      return null
    }
    if (revealState.status === 'awaiting') {
      return revealState
    }
    return currentFile?.id === revealState.fileId && currentImageUrl === revealState.imageUrl ? revealState : null
  })()

  const finishReveal = useCallback(() => {
    setRevealState(null)
  }, [])

  const promptBar = painting.prompt ? <ArtboardPromptBar prompt={painting.prompt} sizeLabel={sizeLabel} /> : undefined

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col p-2">
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center [container-type:size]">
        {isLoading || activeReveal ? (
          <PaintingImageSkeleton
            imageUrl={activeReveal?.status === 'ready' ? activeReveal.imageUrl : undefined}
            naturalWidth={activeReveal?.status === 'ready' ? activeReveal.naturalWidth : undefined}
            naturalHeight={activeReveal?.status === 'ready' ? activeReveal.naturalHeight : undefined}
            onRevealReady={activeReveal?.status === 'ready' ? finishReveal : undefined}
            painting={painting}
            topBar={promptBar}
          />
        ) : painting.files.length > 0 && currentImageUrl ? (
          <div
            ref={setViewerContainerRef}
            className="relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden">
            {/* The prompt bar is a flex-col sibling of the transformed image so it stays
                fixed while the image pans, zooms, or rotates. The layout wrapper is
                sized explicitly (displayedImageBoxSize, which already
                reserves the bar's own measured height — see setPromptBarRef) rather than
                via CSS auto-sizing — ImageViewer nests the `<img>` behind a context-menu
                wrapper that breaks intrinsic-size propagation, so an auto-sized flex-col
                here ends up wider than the rendered photo, letterboxing the bar past its
                real edges. */}
            <div
              data-testid="artboard-image-layout"
              className="flex max-h-full max-w-full flex-col items-stretch"
              style={{
                ...(displayedImageBoxSize ? { width: displayedImageBoxSize.width } : undefined)
              }}>
              {promptBar && (
                <div ref={setPromptBarRef} data-testid="artboard-prompt-bar-measure">
                  {promptBar}
                </div>
              )}
              <ImageViewer
                alt=""
                data-testid="artboard-image-transform"
                className={`max-h-full min-h-0 max-w-full select-none rounded-md object-contain ${
                  isDraggingImage
                    ? 'cursor-grabbing transition-none will-change-transform'
                    : 'cursor-grab transition-transform duration-150'
                }`}
                draggable={false}
                onLoad={onDisplayedImageLoad}
                onPointerCancel={stopImageDrag}
                onPointerDown={onImagePointerDown}
                onPointerMove={onImagePointerMove}
                onPointerUp={stopImageDrag}
                preview={false}
                src={currentImageUrl}
                style={{
                  touchAction: 'none',
                  transform: `translate(${imageOffset.x}px, ${imageOffset.y}px) scale(${imageScale}) rotate(${imageRotation}deg)`,
                  ...(displayedImageBoxSize ? { height: displayedImageBoxSize.height } : undefined)
                }}
              />
            </div>
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
        ) : (
          <div
            role="img"
            aria-label={t('paintings.image_placeholder')}
            className="relative size-[min(72cqh,96cqw)] rounded-3xl border border-border-subtle bg-[linear-gradient(145deg,var(--muted),transparent_58%)]">
            <div
              aria-hidden
              className="absolute inset-2 rounded-2xl border border-border-subtle bg-background-subtle"
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default Artboard
