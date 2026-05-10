import { ChevronLeft, ChevronRight } from 'lucide-react'
import * as React from 'react'

import { cn } from '../../../lib/utils'
import { Button } from '../../primitives/button'
import { Dialog, DialogContent, DialogTitle } from '../../primitives/dialog'
import { ImagePreviewContextMenu } from './ImagePreviewContextMenu'
import { ImagePreviewImage } from './ImagePreviewImage'
import { ImagePreviewToolbar } from './ImagePreviewToolbar'
import {
  DEFAULT_IMAGE_PREVIEW_LABELS,
  type ImagePreviewAction,
  type ImagePreviewActionErrorHandler,
  type ImagePreviewItem,
  type ImagePreviewLabels
} from './types'
import { useImagePreviewTransform } from './useImagePreviewTransform'

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
  renderImage?: (
    item: ImagePreviewItem,
    context: { transform: ReturnType<typeof useImagePreviewTransform> }
  ) => React.ReactNode
  renderMetadata?: (item: ImagePreviewItem, context: { index: number; items: ImagePreviewItem[] }) => React.ReactNode
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
  renderImage,
  renderMetadata,
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
    setActiveIndex((currentIndex - 1 + items.length) % items.length)
  }, [currentIndex, items.length, setActiveIndex])

  const showNext = React.useCallback(() => {
    setActiveIndex((currentIndex + 1) % items.length)
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
    <Dialog modal={false} open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className={cn(
          'pointer-events-none fixed top-0 left-0 z-50 flex h-screen w-screen max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden rounded-none border-0 bg-transparent p-0 text-foreground shadow-none sm:max-w-none',
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
        overlayClassName={cn('bg-background/70 backdrop-blur-xl dark:bg-background/65', overlayClassName)}
        onPointerDownOutside={close}
        showCloseButton={false}>
        <DialogTitle className="sr-only">{mergedLabels.dialogTitle ?? mergedLabels.close}</DialogTitle>
        <div
          className={cn(
            'relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-6 pt-14 pb-8 sm:px-20 sm:pt-16 sm:pb-10',
            contentClassName
          )}>
          {hasMultipleItems && (
            <Button
              aria-label={mergedLabels.previous}
              className="pointer-events-auto absolute left-4 top-1/2 z-10 size-10 -translate-y-1/2 rounded-full border-border/60 bg-background/70 text-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={showPrevious}
              size="icon"
              type="button"
              variant="outline">
              <ChevronLeft className="size-5" />
            </Button>
          )}
          <ImagePreviewContextMenu actions={actions} context={actionContext} item={item} onActionError={onActionError}>
            <div className="pointer-events-none flex h-full max-h-full min-h-0 w-full max-w-full items-center justify-center">
              <div className="pointer-events-auto flex h-full max-h-full min-h-0 w-full max-w-full items-center justify-center">
                {renderImage ? (
                  renderImage(item, { transform: transformControls })
                ) : (
                  <ImagePreviewImage className={imageClassName} item={item} transform={transformControls.transform} />
                )}
              </div>
            </div>
          </ImagePreviewContextMenu>
          {hasMultipleItems && (
            <Button
              aria-label={mergedLabels.next}
              className="pointer-events-auto absolute right-4 top-1/2 z-10 size-10 -translate-y-1/2 rounded-full border-border/60 bg-background/70 text-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={showNext}
              size="icon"
              type="button"
              variant="outline">
              <ChevronRight className="size-5" />
            </Button>
          )}
        </div>
        {renderMetadata && (
          <div className="pointer-events-auto px-6 pb-3">{renderMetadata(item, { index: currentIndex, items })}</div>
        )}
        <div className="pointer-events-auto flex justify-center px-4 pb-6">
          <ImagePreviewToolbar
            actions={toolbarActions}
            context={actionContext}
            item={item}
            labels={mergedLabels}
            onActionError={onActionError}
            onClose={close}
            transformControls={transformControls}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
