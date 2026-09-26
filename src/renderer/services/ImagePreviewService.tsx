import CopyIcon from 'lucide-react/dist/esm/icons/copy'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type ImagePreviewAction,
  ImagePreviewDialog,
  type ImagePreviewItem,
  type ImagePreviewLabels
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import {
  copyImageToClipboard,
  type ImageInput,
  imageInputToPreviewUrl,
  type ImagePreviewOptions
} from '@renderer/utils/image'

const logger = loggerService.withContext('ImagePreviewService')

type PreviewProps = { src: string } & PopupInjectedProps<void>

const ImagePreviewContainer: React.FC<PreviewProps> = ({ src, open, resolve }) => {
  const { t } = useTranslation()
  const labels = useMemo<Partial<ImagePreviewLabels>>(
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

  const handleVisibleChange = (visible: boolean) => {
    if (!visible) {
      // Revoke the object URL on the close path (createObjectURL happens in
      // imageInputToPreviewUrl for SVG elements and blobs).
      if (src.startsWith('blob:')) {
        URL.revokeObjectURL(src)
      }
      resolve()
    }
  }

  const handleCopyImage = useCallback(
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

  const contextActions = useMemo<ImagePreviewAction[]>(
    () => [
      {
        icon: <CopyIcon className="size-4" />,
        id: 'copy-image',
        label: t('preview.copy.image'),
        onSelect: handleCopyImage
      }
    ],
    [handleCopyImage, t]
  )

  return (
    <ImagePreviewDialog
      actions={contextActions}
      items={[{ id: src, src }]}
      labels={labels}
      onOpenChange={handleVisibleChange}
      open={open}
    />
  )
}

const imagePreviewPopup = createPopup<{ src: string }, void>(ImagePreviewContainer, { dismissResult: undefined })

export type { ImageInput, ImagePreviewOptions }

/**
 * Image preview service — resolves any supported input to a URL and shows it in the
 * shared image preview dialog (a createPopup popup). "Opens a popup" is a services
 * concern; the popup rendering lives in ImagePreviewContainer via PopupHost.
 */
export class ImagePreviewService {
  static async show(input: ImageInput, options: ImagePreviewOptions = {}): Promise<void> {
    try {
      const src = await imageInputToPreviewUrl(input, options)
      await imagePreviewPopup.show({ src })
    } catch (error) {
      logger.error('Failed to show image preview:', error as Error)
      throw error
    }
  }
}
