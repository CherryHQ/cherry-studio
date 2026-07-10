import { EmptyState, ImagePreviewTrigger } from '@cherrystudio/ui'
import { AlertCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ImagePreviewPanelProps {
  /** `file://` URL of the image on disk (from `toFileUrl`). */
  src: string
  fileName: string
}

/**
 * Renders a workspace image centered in the preview pane. Clicking opens the
 * shared zoom/rotate/download dialog. Images render straight from disk via a
 * `file://` URL — no binary read — so they bypass the text/size gating in
 * `ArtifactFilePreview`. `<img>` does not execute embedded scripts, so SVG is
 * safe to render this way.
 */
const ImagePreviewPanel = ({ src, fileName }: ImagePreviewPanelProps) => {
  const { t } = useTranslation()
  const [errored, setErrored] = useState(false)

  // Re-attempt the load when the source changes (e.g. selecting a different
  // file, or a refresh) so a prior failure doesn't stick.
  useEffect(() => setErrored(false), [src])

  const labels = useMemo(
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

  if (errored) {
    return (
      <EmptyState
        icon={AlertCircle}
        title={t('agent.preview_pane.unavailable.title')}
        description={t('agent.preview_pane.unavailable.description')}
      />
    )
  }

  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden bg-background p-4">
      <ImagePreviewTrigger
        item={{ id: src, src, alt: fileName, title: fileName }}
        alt={fileName}
        dialogProps={{ labels }}
        className="max-h-full max-w-full cursor-zoom-in object-contain"
        onError={() => setErrored(true)}
      />
    </div>
  )
}

export default ImagePreviewPanel
