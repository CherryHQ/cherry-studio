import { useComposerToolDispatch, useComposerToolState } from '@renderer/components/composer/ComposerToolRuntime'
import ImageViewer from '@renderer/components/ImageViewer'
import { toComposerAttachments } from '@renderer/utils/message/composerAttachment'
import type { FilePath } from '@shared/types/file'
import { toSafeFileUrl } from '@shared/utils/file'
import { Plus, X } from 'lucide-react'
import { type FC, type MouseEvent, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const TILE_CLASS = 'inline-flex size-14 shrink-0 items-center justify-center rounded-lg border border-dashed'

function imagePreviewUrl(path: string, ext: string): string {
  return toSafeFileUrl(path as FilePath, ext.replace(/^\./, '').toLowerCase() || null)
}

/**
 * Leading image-upload tray, pinned to the left of the paintings composer input
 * (via `ComposerSurface`'s `leadingContent`). Reads/writes the composer's `files`
 * through context, so uploads flow through the same pipeline as toolbar/paste/drop
 * and reach `painting.inputFiles` via `usePaintingComposerInputFiles`. A row of
 * image preview tiles (each removable) followed by a dashed "+" upload tile.
 */
export const PaintingImageGallery: FC = () => {
  const { t } = useTranslation()
  const { files, extensions } = useComposerToolState()
  const { setFiles } = useComposerToolDispatch()
  const [selecting, setSelecting] = useState(false)

  // Preview items for the lightbox — the whole tray, so clicking any tile opens a
  // navigable gallery starting at that image (matched by `src`).
  const previewItems = useMemo(
    () =>
      files.map((file) => ({
        id: file.fileTokenSourceId,
        src: imagePreviewUrl(file.path, file.ext),
        alt: file.origin_name
      })),
    [files]
  )

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

  const removeImage = useCallback(
    (sourceId: string) => {
      setFiles((current) => current.filter((file) => file.fileTokenSourceId !== sourceId))
    },
    [setFiles]
  )

  // Stop the remove/add clicks from bubbling to the tile (which would open the viewer) or the input frame.
  const stop = (event: MouseEvent) => event.stopPropagation()

  return (
    <div className="flex max-w-52 flex-wrap items-center gap-1.5">
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
        className={`${TILE_CLASS} border-border-muted text-muted-foreground transition-colors hover:border-border-hover hover:text-foreground`}>
        <Plus className="size-5" aria-hidden />
      </button>
    </div>
  )
}
