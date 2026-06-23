import { loggerService } from '@logger'
import type { FileEntry } from '@shared/data/types/file/fileEntry'
import type { FilePath } from '@shared/types/file/common'
import { toSafeFileUrl } from '@shared/utils/file/urlUtil'
import { ImagePlus, X } from 'lucide-react'
import { type ChangeEvent, type FC, useCallback, useEffect, useRef, useState } from 'react'

const logger = loggerService.withContext('creation/VideoMediaInput')

/** Adapt a picked File into a v2 FileEntry (mirrors PaintingPromptBar's helper). */
async function fileToFileEntry(file: File): Promise<FileEntry | null> {
  try {
    const filePath = window.api.file.getPathForFile(file)
    if (filePath) {
      return await window.api.file.createInternalEntry({ source: 'path', path: filePath as FilePath })
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const lastDot = file.name.lastIndexOf('.')
    const name = lastDot > 0 ? file.name.slice(0, lastDot) : file.name || 'frame'
    const ext = lastDot > 0 ? file.name.slice(lastDot + 1).toLowerCase() : null
    return await window.api.file.createInternalEntry({ source: 'bytes', data: bytes, name, ext })
  } catch (error) {
    logger.error('failed to create FileEntry from File', error as Error)
    return null
  }
}

interface VideoMediaInputProps {
  label: string
  value?: FileEntry
  disabled?: boolean
  onChange: (entry: FileEntry | undefined) => void
}

/**
 * Single labeled image picker for a video media input (first frame / last
 * frame). Picks one image, adapts it to a FileEntry, and renders a removable
 * thumbnail. Reference-image grids / video uploads are not yet surfaced.
 */
const VideoMediaInput: FC<VideoMediaInputProps> = ({ label, value, disabled, onChange }) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!value) {
      setUrl(null)
      return
    }
    let cancelled = false
    window.api.file
      .getPhysicalPath({ id: value.id })
      .then((path) => {
        if (!cancelled) setUrl(toSafeFileUrl(path, value.ext ?? null))
      })
      .catch((error) => {
        if (!cancelled) logger.error('getPhysicalPath failed for media input', error as Error)
      })
    return () => {
      cancelled = true
    }
  }, [value])

  const onPick = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      const entry = await fileToFileEntry(file)
      if (entry) onChange(entry)
    },
    [onChange]
  )

  return (
    <div className="flex flex-col gap-1.5">
      <span className="select-none text-muted-foreground text-xs uppercase tracking-wider">{label}</span>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={onPick} />
      {value ? (
        <div className="group relative size-20 overflow-hidden rounded-lg border border-border bg-muted/30">
          {url ? <img src={url} className="size-full object-cover" alt={label} /> : null}
          <button
            type="button"
            onClick={() => onChange(undefined)}
            aria-label="remove"
            className="absolute top-0.5 right-0.5 z-10 flex size-4 cursor-pointer items-center justify-center rounded-full bg-background/95 text-foreground opacity-0 shadow-sm transition group-hover:opacity-100">
            <X className="size-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="flex size-20 items-center justify-center rounded-lg border border-border border-dashed bg-muted/20 text-muted-foreground transition hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50">
          <ImagePlus className="size-5" />
        </button>
      )}
    </div>
  )
}

export default VideoMediaInput
