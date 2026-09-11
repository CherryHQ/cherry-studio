import { CopyIcon, SaveIcon } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import {
  type ImagePreviewAction,
  type ImagePreviewActionContext,
  ImagePreviewDialog,
  type ImagePreviewItem,
  type ImagePreviewLabels,
  type ImagePreviewTransform
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import { toast } from '@renderer/services/toast'
import { removeSpecialCharactersForFileName } from '@renderer/utils/file'
import {
  blobToDataUrl,
  convertImageToPng,
  copyImageToClipboard,
  getImageBlobFromSource,
  transformImageToPng
} from '@renderer/utils/image'
import { cn } from '@renderer/utils/style'

export { copyImageToClipboard } from '@renderer/utils/image'

const logger = loggerService.withContext('ImageViewer')

export interface ImageViewerPreviewConfig {
  actions?: ImagePreviewAction[]
  items?: ImagePreviewItem[]
  toolbarActions?: ImagePreviewAction[]
}

export interface ImageViewerProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  contextMenuTransform?: Partial<ImagePreviewTransform>
  preview?: boolean | ImageViewerPreviewConfig
  src: string
}

const getPreviewIndex = (items: ImagePreviewItem[], src: string, fallbackIndex = 0) => {
  const matchedIndex = items.findIndex((item) => item.src === src)
  return matchedIndex >= 0 ? matchedIndex : fallbackIndex
}

const getImageSaveName = (item: ImagePreviewItem) => {
  let name = item.alt?.trim()

  if (!name && /^(?:file|https?):/.test(item.src)) {
    try {
      const pathname = decodeURIComponent(new URL(item.src).pathname)
      name = pathname.slice(pathname.lastIndexOf('/') + 1)
    } catch {
      // Fall back to the generic image name below.
    }
  }

  const nameWithoutImageExtension = name?.replace(/\.(?:avif|bmp|gif|heic|jpe?g|png|svg|webp)$/i, '')
  return removeSpecialCharactersForFileName(nameWithoutImageExtension || '') || 'image'
}

const ImageViewer: React.FC<ImageViewerProps> = ({
  alt,
  className,
  contextMenuTransform,
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

  const handleSaveImage = React.useCallback(
    async (item: ImagePreviewItem, context: ImagePreviewActionContext) => {
      try {
        const blob = await getImageBlobFromSource(item.src)
        const { flipX, flipY, rotation } = context.transform
        const pngBlob =
          rotation % 360 !== 0 || flipX || flipY
            ? await transformImageToPng(blob, { flipX, flipY, rotation })
            : await convertImageToPng(blob)
        const saved = await window.api.file.saveImage(getImageSaveName(item), await blobToDataUrl(pngBlob))
        if (saved) {
          toast.success(t('common.saved'))
        }
      } catch (error) {
        const err = error as Error
        logger.error(`Failed to save image: ${err.message}`, { stack: err.stack })
        toast.error(t('common.save_failed'))
      }
    },
    [t]
  )

  const saveAction = React.useMemo<ImagePreviewAction>(
    () => ({
      icon: <SaveIcon className="size-3.5" />,
      id: 'save-as',
      label: t('preview.save_as'),
      onSelect: handleSaveImage
    }),
    [handleSaveImage, t]
  )

  const builtInActions = React.useMemo<ImagePreviewAction[]>(
    () => [
      {
        icon: <CopyIcon className="size-3.5" />,
        id: 'copy-image',
        label: t('preview.copy.image'),
        onSelect: handleCopyImage
      },
      saveAction,
      {
        icon: <CopyIcon className="size-3.5" />,
        id: 'copy-src',
        label: t('preview.copy.src'),
        onSelect: handleCopySource
      }
    ],
    [handleCopyImage, handleCopySource, saveAction, t]
  )

  const contextActions = React.useMemo(
    () => [...builtInActions, ...(previewConfig?.actions ?? [])],
    [builtInActions, previewConfig?.actions]
  )
  const toolbarActions = React.useMemo(
    () => [saveAction, ...(previewConfig?.toolbarActions ?? [])],
    [previewConfig?.toolbarActions, saveAction]
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
  const resolvedContextMenuTransform = React.useMemo<ImagePreviewTransform>(
    () => ({
      flipX: contextMenuTransform?.flipX ?? false,
      flipY: contextMenuTransform?.flipY ?? false,
      offsetX: contextMenuTransform?.offsetX ?? 0,
      offsetY: contextMenuTransform?.offsetY ?? 0,
      rotation: contextMenuTransform?.rotation ?? 0,
      zoom: contextMenuTransform?.zoom ?? 1
    }),
    [contextMenuTransform]
  )
  const contextMenuActionContext = React.useMemo(
    () => ({
      close: () => setOpen(false),
      index: displayIndex,
      items,
      resetTransform: () => {},
      transform: resolvedContextMenuTransform
    }),
    [displayIndex, items, resolvedContextMenuTransform, setOpen]
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
          toolbarActions={toolbarActions}
        />
      )}
    </>
  )
}

export default ImageViewer
