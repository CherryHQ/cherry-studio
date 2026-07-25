import { useComposerToolDispatch, useComposerToolState } from '@renderer/components/composer/ComposerToolRuntime'
import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import ImageViewer from '@renderer/components/ImageViewer'
import { FILE_TYPE } from '@renderer/types/file'
import { toComposerAttachments } from '@renderer/utils/message/composerAttachment'
import type { FilePath } from '@shared/types/file'
import { toSafeFileUrl } from '@shared/utils/file'
import { Plus, X } from 'lucide-react'
import { type FC, type MouseEvent, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

function imagePreviewUrl(path: string, ext: string): string {
  return toSafeFileUrl(path as FilePath, ext.replace(/^\./, '').toLowerCase() || null)
}

// Stop button clicks from bubbling to the tile (which would open the viewer) or the input frame.
const stop = (event: MouseEvent) => event.stopPropagation()

/**
 * Round "+" upload button, shown on the editor row (Grok-style, via `ComposerSurface`'s
 * `leadingContent`). Picks image files into the composer's `files`, which flow through
 * the same pipeline as toolbar/paste/drop and reach `painting.inputFiles`.
 */
export const PaintingImageAddButton: FC = () => {
  const { t } = useTranslation()
  const { extensions } = useComposerToolState()
  const { setFiles } = useComposerToolDispatch()
  const [selecting, setSelecting] = useState(false)

  const pickImages = useCallback(async () => {
    if (selecting) return
    setSelecting(true)
    try {
      const picked = await window.api.file.select({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Images', extensions: extensions.map((ext) => ext.replace(/^\./, '')) }]
      })
      if (picked?.length) {
        setFiles((current) => [...current, ...toComposerAttachments(picked)])
      }
    } finally {
      setSelecting(false)
    }
  }, [extensions, selecting, setFiles])

  return (
    <button
      type="button"
      aria-label={t('paintings.add_image')}
      title={t('paintings.add_image')}
      disabled={selecting}
      onMouseDown={stop}
      onClick={(event) => {
        stop(event)
        void pickImages()
      }}
      className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border-muted text-muted-foreground transition-colors hover:border-border-hover hover:bg-accent hover:text-foreground">
      <Plus className="size-5" aria-hidden />
    </button>
  )
}

/**
 * Top reference-image strip (via `ComposerSurface`'s `topContent`): a horizontally-scrolling
 * row of preview tiles (each removable, click to open the ImageViewer). Renders nothing until
 * at least one image is attached. Reads the composer's `files` from context.
 */
export const PaintingImageGallery: FC = () => {
  const { t } = useTranslation()
  const { files } = useComposerToolState()
  const { setFiles } = useComposerToolDispatch()

  // Preview items for the lightbox — image attachments only, so a non-image (e.g. a
  // pasted-text `.txt`) never renders as a broken tile. Clicking any tile opens a
  // navigable gallery starting at that image (matched by `src`).
  const previewItems = useMemo(
    () =>
      files
        .filter((file) => file.type === FILE_TYPE.IMAGE)
        .map((file) => ({
          id: file.fileTokenSourceId,
          src: imagePreviewUrl(file.path, file.ext),
          alt: file.origin_name
        })),
    [files]
  )

  const removeImage = useCallback(
    (sourceId: string) => {
      setFiles((current) => current.filter((file) => file.fileTokenSourceId !== sourceId))
    },
    [setFiles]
  )

  if (previewItems.length === 0) return null

  return (
    <div className="px-3.5 pt-2.5">
      <HorizontalScrollContainer dependencies={[previewItems.length]} gap="6px">
        {previewItems.map((item) => (
          <span
            key={item.id}
            className="group/tile relative inline-flex size-14 shrink-0 overflow-hidden rounded-lg border border-border-subtle">
            <ImageViewer
              src={item.src}
              alt={item.alt}
              draggable={false}
              className="size-full cursor-pointer object-cover"
              preview={{ items: previewItems }}
            />
            <button
              type="button"
              aria-label={t('common.delete')}
              title={t('common.delete')}
              onMouseDown={stop}
              onClick={(event) => {
                stop(event)
                removeImage(item.id)
              }}
              className="absolute top-0.5 right-0.5 z-1 inline-flex size-4 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-focus-within/tile:opacity-100 group-hover/tile:opacity-100">
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}
      </HorizontalScrollContainer>
    </div>
  )
}
