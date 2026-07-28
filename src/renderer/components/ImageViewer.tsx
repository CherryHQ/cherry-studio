import {
  type ImagePreviewAction,
  ImagePreviewDialog,
  type ImagePreviewItem,
  type ImagePreviewLabels
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import { toast } from '@renderer/services/toast'
import { convertImageToPng, getImageBlobFromSource } from '@renderer/utils/image'
import { sanitizeFilename } from '@shared/utils/file'
import { CopyIcon, DownloadIcon } from 'lucide-react'
import mime from 'mime'
import React from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('ImageViewer')

export interface ImageViewerPreviewConfig {
  activeIndex?: number
  actions?: ImagePreviewAction[]
  defaultActiveIndex?: number
  items?: ImagePreviewItem[]
  mask?: boolean
  onActiveIndexChange?: (index: number) => void
  onVisibleChange?: (visible: boolean) => void
  src?: string
  toolbarActions?: ImagePreviewAction[]
  visible?: boolean
}

export interface ImageViewerProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  preview?: boolean | ImageViewerPreviewConfig
  src: string
}

export async function copyImageToClipboard(src: string): Promise<void> {
  const blob = await getImageBlobFromSource(src)
  const pngBlob = await convertImageToPng(blob)
  const item = new ClipboardItem({
    'image/png': pngBlob
  })

  await navigator.clipboard.write([item])
}

function getImageFileNameFromSource(src: string, mimeType: string): string {
  const extension = mime.getExtension(mimeType) || 'png'

  if (src.startsWith('file://') || src.startsWith('http://') || src.startsWith('https://')) {
    try {
      const sourceName = sanitizeFilename(
        decodeURIComponent(new URL(src).pathname.split('/').filter(Boolean).at(-1) ?? '')
      )
      if (sourceName) {
        return /\.[^.]+$/.test(sourceName) ? sourceName : `${sourceName}.${extension}`
      }
    } catch {
      // Fall through to the default image filename.
    }
  }

  return `image.${extension}`
}

function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer))
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image data'))
    reader.readAsArrayBuffer(blob)
  })
}

export async function saveImageFromSource(src: string): Promise<string | null> {
  const blob = await getImageBlobFromSource(src)
  const bytes = await blobToUint8Array(blob)
  return window.api.file.save(getImageFileNameFromSource(src, blob.type), bytes)
}

const getPreviewIndex = (items: ImagePreviewItem[], src: string, fallbackIndex = 0) => {
  const matchedIndex = items.findIndex((item) => item.src === src)
  return matchedIndex >= 0 ? matchedIndex : fallbackIndex
}

const ImageViewer: React.FC<ImageViewerProps> = ({ alt, onClick, onContextMenu, preview, src, ...props }) => {
  const { t } = useTranslation()
  const previewConfig = typeof preview === 'object' ? preview : undefined
  const previewEnabled = preview !== false
  const previewSrc = previewConfig?.src ?? src
  const items = React.useMemo<ImagePreviewItem[]>(() => {
    return (
      previewConfig?.items ?? [
        {
          alt: typeof alt === 'string' ? alt : undefined,
          id: previewSrc,
          src: previewSrc
        }
      ]
    )
  }, [alt, previewConfig?.items, previewSrc])

  const initialIndex = React.useMemo(
    () => previewConfig?.activeIndex ?? previewConfig?.defaultActiveIndex ?? getPreviewIndex(items, previewSrc),
    [items, previewConfig?.activeIndex, previewConfig?.defaultActiveIndex, previewSrc]
  )
  const [localOpen, setLocalOpen] = React.useState(false)
  const [localActiveIndex, setLocalActiveIndex] = React.useState(initialIndex)
  const open = previewConfig?.visible ?? localOpen
  const activeIndex = previewConfig?.activeIndex ?? localActiveIndex

  React.useEffect(() => {
    setLocalActiveIndex(initialIndex)
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

  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (previewConfig?.visible == null) {
        setLocalOpen(nextOpen)
      }
      previewConfig?.onVisibleChange?.(nextOpen)
    },
    [previewConfig]
  )

  const setActiveIndex = React.useCallback(
    (nextIndex: number) => {
      if (previewConfig?.activeIndex == null) {
        setLocalActiveIndex(nextIndex)
      }
      previewConfig?.onActiveIndexChange?.(nextIndex)
    },
    [previewConfig]
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

  const handleDownloadImage = React.useCallback(
    async (item: ImagePreviewItem) => {
      try {
        const savedPath = await saveImageFromSource(item.src)
        if (savedPath) {
          toast.success(t('message.download.success'))
        }
      } catch (error) {
        const err = error as Error
        logger.error(`Failed to download image: ${err.message}`, { stack: err.stack })
        toast.error(t('message.download.failed'))
      }
    },
    [t]
  )

  const builtInActions = React.useMemo<ImagePreviewAction[]>(
    () => [
      {
        icon: <CopyIcon className="size-3.5" />,
        id: 'copy-image',
        label: t('common.copy'),
        onSelect: handleCopyImage
      },
      {
        icon: <CopyIcon className="size-3.5" />,
        id: 'copy-src',
        label: t('preview.copy.src'),
        onSelect: handleCopySource
      },
      {
        icon: <DownloadIcon className="size-3.5" />,
        id: 'download',
        label: t('common.download'),
        onSelect: handleDownloadImage
      }
    ],
    [handleCopyImage, handleCopySource, handleDownloadImage, t]
  )

  const contextActions = React.useMemo(
    () => [...builtInActions, ...(previewConfig?.actions ?? [])],
    [builtInActions, previewConfig?.actions]
  )
  const toolbarActions = React.useMemo(
    () => [builtInActions[0], builtInActions[2], ...(previewConfig?.toolbarActions ?? [])],
    [builtInActions, previewConfig?.toolbarActions]
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
  const contextMenuTransform = React.useMemo(() => ({ flipX: false, flipY: false, rotate: 0, scale: 1 }), [])
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
