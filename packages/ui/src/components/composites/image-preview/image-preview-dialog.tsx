import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import * as React from 'react'

import { cn } from '../../../lib/utils'
import { Button } from '../../primitives/button'
import { Dialog, DialogContent, DialogTitle } from '../../primitives/dialog'
import { ImagePreviewToolbar } from './image-preview-toolbar'
import { ImagePreviewViewport } from './image-preview-viewport'
import {
  DEFAULT_IMAGE_PREVIEW_LABELS,
  type ImagePreviewAction,
  type ImagePreviewActionErrorHandler,
  type ImagePreviewItem,
  type ImagePreviewLabels
} from './types'
import { useImagePreviewTransform } from './use-image-preview-transform'

export interface ImagePreviewDialogProps {
  actions?: ImagePreviewAction[]
  activeIndex?: number
  className?: string
  contentClassName?: string
  defaultActiveIndex?: number
  imageClassName?: string
  items: ImagePreviewItem[]
  labels?: Partial<ImagePreviewLabels>
  onActiveIndexChange?: (index: number) => void
  onActionError?: ImagePreviewActionErrorHandler
  onOpenChange: (open: boolean) => void
  open: boolean
  overlayClassName?: string
  toolbarActions?: ImagePreviewAction[]
}

const clampIndex = (index: number, length: number) => {
  if (length <= 0) {
    return 0
  }
  return Math.min(length - 1, Math.max(0, index))
}

export function ImagePreviewDialog({
  actions = [],
  activeIndex,
  className,
  contentClassName,
  defaultActiveIndex = 0,
  imageClassName,
  items,
  labels,
  onActiveIndexChange,
  onActionError,
  onOpenChange,
  open,
  overlayClassName,
  toolbarActions = []
}: ImagePreviewDialogProps) {
  const mergedLabels = React.useMemo(() => ({ ...DEFAULT_IMAGE_PREVIEW_LABELS, ...labels }), [labels])
  const [uncontrolledIndex, setUncontrolledIndex] = React.useState(defaultActiveIndex)
  const transformControls = useImagePreviewTransform()
  const { reset } = transformControls
  const currentIndex = clampIndex(activeIndex ?? uncontrolledIndex, items.length)
  const item = items[currentIndex]
  const hasMultipleItems = items.length > 1

  React.useEffect(() => {
    if (open) {
      reset()
    }
  }, [currentIndex, open, reset])

  React.useEffect(() => {
    if (activeIndex == null) {
      setUncontrolledIndex((current) => clampIndex(current, items.length))
    }
  }, [activeIndex, items.length])

  const setActiveIndex = React.useCallback(
    (nextIndex: number) => {
      const clampedIndex = clampIndex(nextIndex, items.length)
      if (activeIndex == null) {
        setUncontrolledIndex(clampedIndex)
      }
      onActiveIndexChange?.(clampedIndex)
    },
    [activeIndex, items.length, onActiveIndexChange]
  )

  const showPrevious = React.useCallback(() => {
    setActiveIndex(Math.max(0, currentIndex - 1))
  }, [currentIndex, setActiveIndex])

  const showNext = React.useCallback(() => {
    setActiveIndex(Math.min(items.length - 1, currentIndex + 1))
  }, [currentIndex, items.length, setActiveIndex])

  const close = React.useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  if (!item) {
    return null
  }

  const actionContext = {
    close,
    index: currentIndex,
    items,
    resetTransform: reset,
    transform: transformControls.transform
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className={cn(
          'fixed top-0 left-0 z-[80] h-screen w-screen max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 bg-transparent p-0 shadow-none data-[state=closed]:animate-none data-[state=open]:animate-none sm:max-w-none',
          className
        )}
        data-testid="image-preview-dialog"
        onKeyDown={(event) => {
          if (!hasMultipleItems) {
            return
          }
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            showPrevious()
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            showNext()
          }
        }}
        overlayClassName={cn(
          'bg-black/70 data-[state=closed]:animate-none data-[state=open]:animate-none',
          overlayClassName
        )}
        showCloseButton={false}>
        <div className="relative h-full w-full">
          <DialogTitle className="sr-only">{mergedLabels.dialogTitle ?? mergedLabels.close}</DialogTitle>
          <Button
            aria-label={mergedLabels.close}
            className="absolute top-4 right-4 z-20 size-9 rounded-none bg-transparent p-0 text-white shadow-none transition-none hover:bg-transparent hover:text-white"
            onClick={close}
            size="icon"
            type="button"
            variant="ghost">
            <X className="size-5" />
          </Button>
          <div
            className={cn('absolute inset-0 px-6 pt-14 pb-20 sm:px-20 sm:pt-16 sm:pb-24', contentClassName)}
            onClick={(event) => {
              if (event.target === event.currentTarget) close()
            }}>
            <ImagePreviewViewport
              actionContext={actionContext}
              actions={actions}
              imageClassName={imageClassName}
              item={item}
              onActionError={onActionError}
              onBackdropClick={close}
              transformControls={transformControls}
            />
          </div>
          {hasMultipleItems && (
            <Button
              aria-label={mergedLabels.previous}
              className="absolute left-4 top-1/2 z-10 size-10 -translate-y-1/2 rounded-full border-border bg-popover text-popover-foreground shadow-md hover:bg-accent hover:text-accent-foreground disabled:opacity-30"
              disabled={currentIndex === 0}
              onClick={showPrevious}
              size="icon"
              type="button"
              variant="outline">
              <ChevronLeft className="size-5" />
            </Button>
          )}
          {hasMultipleItems && (
            <Button
              aria-label={mergedLabels.next}
              className="absolute right-4 top-1/2 z-10 size-10 -translate-y-1/2 rounded-full border-border bg-popover text-popover-foreground shadow-md hover:bg-accent hover:text-accent-foreground disabled:opacity-30"
              disabled={currentIndex === items.length - 1}
              onClick={showNext}
              size="icon"
              type="button"
              variant="outline">
              <ChevronRight className="size-5" />
            </Button>
          )}
          <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 sm:bottom-8">
            <ImagePreviewToolbar
              actions={toolbarActions}
              context={actionContext}
              item={item}
              labels={mergedLabels}
              onActionError={onActionError}
              transformControls={transformControls}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
