import {
  type ImagePreviewAction,
  ImagePreviewDialog,
  type ImagePreviewItem,
  type ImagePreviewLabels
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import { toast } from '@renderer/services/toast'
import { copyImageToClipboard } from '@renderer/utils/image'
import { cn } from '@renderer/utils/style'
import { CopyIcon } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'

export { copyImageToClipboard } from '@renderer/utils/image'

const logger = loggerService.withContext('ImageViewer')

export interface ImageViewerPreviewConfig {
  actions?: ImagePreviewAction[]
  items?: ImagePreviewItem[]
  toolbarActions?: ImagePreviewAction[]
}

export interface ImageViewerProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  preview?: boolean | ImageViewerPreviewConfig
  src: string
}

const getPreviewIndex = (items: ImagePreviewItem[], src: string, fallbackIndex = 0) => {
  const matchedIndex = items.findIndex((item) => item.src === src)
  return matchedIndex >= 0 ? matchedIndex : fallbackIndex
}

const ImageViewer: React.FC<ImageViewerProps> = ({
  alt,
  className,
  onClick,
  onContextMenu,
  preview,
  src,
  ...props
}) => {
  const { t } = useTranslation()
  const previewConfig = typeof preview === 'object' ? preview : undefined
  const previewEnabled = preview !== false
  const items = React.useMemo<ImagePreviewItem[]>(() => {
    return (
      previewConfig?.items ?? [
        {
          alt: typeof alt === 'string' ? alt : undefined,
          id: src,
          src
        }
      ]
    )
  }, [alt, previewConfig?.items, src])

  const initialIndex = React.useMemo(() => getPreviewIndex(items, src), [items, src])
  const [open, setOpen] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState(initialIndex)

  React.useEffect(() => {
    setActiveIndex(initialIndex)
  }, [initialIndex])

  const labels = React.useMemo<Partial<ImagePreviewLabels>>(
    () => ({
      close: t('preview.close'),
      dialogTitle: t('preview.label'),
      flipHorizontal: t('preview.flip_horizontal'),
      flipVertical: t('preview.flip_vertical'),
      next: t('preview.next'),
      previous: t('preview.previous'),
      reset: t('preview.reset'),
      rotateLeft: t('preview.rotate_left'),
      rotateRight: t('preview.rotate_right'),
      zoomIn: t('preview.zoom_in'),
      zoomOut: t('preview.zoom_out')
    }),
    [t]
  )

  const handleCopyImage = React.useCallback(
    async (item: ImagePreviewItem) => {
      try {
        await copyImageToClipboard(item.src)
        toast.success(t('message.copy.success'))
      } catch (error) {
        const err = error as Error
        logger.error(`Failed to copy image: ${err.message}`, { stack: err.stack })
        toast.error(t('message.copy.failed'))
      }
    },
    [t]
  )

  const handleCopySource = React.useCallback(
    async (item: ImagePreviewItem) => {
      try {
        await navigator.clipboard.writeText(item.src)
        toast.success(t('message.copy.success'))
      } catch (error) {
        const err = error as Error
        logger.error(`Failed to copy image source: ${err.message}`, { stack: err.stack })
        toast.error(t('message.copy.failed'))
      }
    },
    [t]
  )

  const builtInActions = React.useMemo<ImagePreviewAction[]>(
    () => [
      {
        icon: <CopyIcon className="size-3.5" />,
        id: 'copy-image',
        label: t('preview.copy.image'),
        onSelect: handleCopyImage
      },
      {
        icon: <CopyIcon className="size-3.5" />,
        id: 'copy-src',
        label: t('preview.copy.src'),
        onSelect: handleCopySource
      }
    ],
    [handleCopyImage, handleCopySource, t]
  )

  const contextActions = React.useMemo(
    () => [...builtInActions, ...(previewConfig?.actions ?? [])],
    [builtInActions, previewConfig?.actions]
  )
  const displayItem = items.find((item) => item.src === src) ?? {
    alt: typeof alt === 'string' ? alt : undefined,
    id: src,
    src
  }
  const displayIndex = Math.max(
    0,
    items.findIndex((item) => item.id === displayItem.id)
  )
  const contextMenuTransform = React.useMemo(
    () => ({ flipX: false, flipY: false, offsetX: 0, offsetY: 0, rotation: 0, zoom: 1 }),
    []
  )
  const contextMenuActionContext = React.useMemo(
    () => ({
      close: () => setOpen(false),
      index: displayIndex,
      items,
      resetTransform: () => {},
      transform: contextMenuTransform
    }),
    [contextMenuTransform, displayIndex, items, setOpen]
  )
  const onActionError = React.useCallback((error: unknown, action: ImagePreviewAction, item: ImagePreviewItem) => {
    logger.error(`Image preview action failed: ${action.id}`, {
      error: error instanceof Error ? error.message : String(error),
      itemId: item.id
    })
  }, [])

  const imageMenuItems = contextActions.map(
    (action): CommandContextMenuExtraItem => ({
      type: 'item',
      id: action.id,
      label: action.label,
      icon: action.icon,
      enabled: !action.disabled,
      onSelect: () => {
        try {
          const result = action.onSelect(displayItem, contextMenuActionContext)
          void Promise.resolve(result).catch((error) => onActionError(error, action, displayItem))
        } catch (error) {
          onActionError(error, action, displayItem)
        }
      }
    })
  )

  const image = (
    <img
      alt={alt}
      className={cn(previewEnabled && 'cursor-zoom-in', className)}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented && previewEnabled) {
          setActiveIndex(initialIndex)
          setOpen(true)
        }
      }}
      onContextMenu={onContextMenu}
      src={src}
      {...props}
    />
  )

  return (
    <>
      <CommandContextMenu location="webcontents.context" extraItems={imageMenuItems}>
        {image}
      </CommandContextMenu>
      {previewEnabled && (
        <ImagePreviewDialog
          actions={contextActions}
          activeIndex={activeIndex}
          items={items}
          labels={labels}
          onActionError={onActionError}
          onActiveIndexChange={setActiveIndex}
          onOpenChange={setOpen}
          open={open}
          toolbarActions={previewConfig?.toolbarActions}
        />
      )}
    </>
  )
}

export default ImageViewer
