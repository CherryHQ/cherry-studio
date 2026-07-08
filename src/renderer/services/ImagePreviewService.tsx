import { loggerService } from '@logger'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { type ImageInput, imageInputToPreviewUrl, type ImagePreviewOptions } from '@renderer/utils/image'
import { lazy, Suspense } from 'react'

const logger = loggerService.withContext('ImagePreviewService')

// Lazy to avoid a circular dependency between this service and ImageViewer; the
// popup carries its own Suspense boundary (uSES updates surface the nearest fallback).
const ImageViewer = lazy(() => import('@renderer/components/ImageViewer'))

type PreviewProps = { src: string } & PopupInjectedProps<void>

const ImagePreviewContainer: React.FC<PreviewProps> = ({ src, open, resolve }) => {
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

  return (
    <Suspense fallback={null}>
      <ImageViewer
        src={src}
        style={{ display: 'none' }}
        preview={{ visible: open, onVisibleChange: handleVisibleChange }}
      />
    </Suspense>
  )
}

const imagePreviewPopup = createPopup<{ src: string }, void>(ImagePreviewContainer, { dismissResult: undefined })

export type { ImageInput, ImagePreviewOptions }

/**
 * Image preview service — resolves any supported input to a URL and shows it in the
 * ImageViewer preview dialog (a createPopup popup). "Opens a popup" is a services
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
