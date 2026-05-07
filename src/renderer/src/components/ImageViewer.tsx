import {
  type ImagePreviewAction,
  ImagePreviewContextMenu,
  ImagePreviewDialog,
  type ImagePreviewItem,
  type ImagePreviewLabels
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { download } from '@renderer/utils/download'
import { convertImageToPng } from '@renderer/utils/image'
import { parseDataUrl } from '@shared/utils'
import { Base64 } from 'js-base64'
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

export async function getImageBlobFromSource(src: string): Promise<Blob> {
  if (src.startsWith('data:')) {
    const parseResult = parseDataUrl(src)
    if (!parseResult || !parseResult.mediaType || !parseResult.isBase64) {
      throw new Error('Invalid base64 image format')
    }
    const byteArray = Base64.toUint8Array(parseResult.data)
    return new Blob([byteArray.slice() as unknown as BlobPart], { type: parseResult.mediaType })
  }

  if (src.startsWith('file://')) {
    const bytes = await window.api.fs.read(src)
    const mimeType = mime.getType(src) || 'application/octet-stream'
    return new Blob([bytes], { type: mimeType })
  }

  const response = await fetch(src)
  return response.blob()
}

export async function copyImageToClipboard(src: string): Promise<void> {
  const blob = await getImageBlobFromSource(src)
  const pngBlob = await convertImageToPng(blob)
  const item = new ClipboardItem({
    'image/png': pngBlob
  })

  await navigator.clipboard.write([item])
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
        window.toast.success(t('message.copy.success'))
      } catch (error) {
        const err = error as Error
        logger.error(`Failed to copy image: ${err.message}`, { stack: err.stack })
        window.toast.error(t('message.copy.failed'))
      }
    },
    [t]
  )

  const handleCopySource = React.useCallback(
    async (item: ImagePreviewItem) => {
      try {
        await navigator.clipboard.writeText(item.src)
        window.toast.success(t('message.copy.success'))
      } catch (error) {
        const err = error as Error
        logger.error(`Failed to copy image source: ${err.message}`, { stack: err.stack })
        window.toast.error(t('message.copy.failed'))
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
        onSelect: (item) => download(item.src)
      }
    ],
    [handleCopyImage, handleCopySource, t]
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
      onContextMenu={(event) => {
        event.stopPropagation()
        onContextMenu?.(event)
      }}
      src={src}
      {...props}
    />
  )

  return (
    <>
      <ImagePreviewContextMenu actions={contextActions} item={displayItem}>
        {image}
      </ImagePreviewContextMenu>
      {previewEnabled && (
        <ImagePreviewDialog
          actions={contextActions}
          activeIndex={activeIndex}
          items={items}
          labels={labels}
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
