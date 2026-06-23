import { Button, Textarea } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { loggerService } from '@logger'
import { useDrag } from '@renderer/hooks/useDrag'
import { useModels } from '@renderer/hooks/useModel'
import SendMessageButton from '@renderer/pages/home/Inputbar/SendMessageButton'
import type { FileEntry } from '@shared/data/types/file/fileEntry'
import type { FilePath } from '@shared/types/file/common'
import { toSafeFileUrl } from '@shared/utils/file/urlUtil'
import { isEditImageModel } from '@shared/utils/model'
import { Plus, X } from 'lucide-react'
import type { ChangeEvent, ClipboardEvent, DragEvent, FC, KeyboardEventHandler, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { PaintingData } from '../model/types/paintingData'

const logger = loggerService.withContext('PaintingPromptBar')

const IMAGE_MIME_PREFIX = 'image/'

async function fileToFileEntry(file: File): Promise<FileEntry | null> {
  try {
    const filePath = window.api.file.getPathForFile(file)
    if (filePath) {
      return await window.api.file.createInternalEntry({ source: 'path', path: filePath as FilePath })
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const lastDot = file.name.lastIndexOf('.')
    const name = lastDot > 0 ? file.name.slice(0, lastDot) : file.name || 'pasted-image'
    const ext = lastDot > 0 ? file.name.slice(lastDot + 1).toLowerCase() : null
    return await window.api.file.createInternalEntry({ source: 'bytes', data: bytes, name, ext })
  } catch (error) {
    logger.error('failed to create FileEntry from File', error as Error)
    return null
  }
}

async function filesToImageEntries(files: Iterable<File>): Promise<FileEntry[]> {
  const images = [...files].filter((f) => f.type.startsWith(IMAGE_MIME_PREFIX))
  const settled = await Promise.all(images.map(fileToFileEntry))
  return settled.filter((entry): entry is FileEntry => entry !== null)
}

interface InputFileThumbnailProps {
  entry: FileEntry
  onRemove: () => void
  removeLabel: string
}

const InputFileThumbnail: FC<InputFileThumbnailProps> = ({ entry, onRemove, removeLabel }) => {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    window.api.file
      .getPhysicalPath({ id: entry.id })
      .then((path) => {
        if (!cancelled) setUrl(toSafeFileUrl(path, entry.ext ?? null))
      })
      .catch((error) => {
        if (!cancelled) logger.error('getPhysicalPath failed for input file', error as Error)
      })
    return () => {
      cancelled = true
    }
  }, [entry.id, entry.ext])
  return (
    <div className="group relative size-14 shrink-0 overflow-hidden rounded-lg border border-border bg-muted/30">
      {url ? <img src={url} className="size-full object-cover" alt={entry.name} /> : null}
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className="absolute top-0.5 right-0.5 z-10 flex size-4 cursor-pointer items-center justify-center rounded-full bg-background/95 text-foreground opacity-0 shadow-sm transition group-hover:opacity-100">
        <X className="size-3" />
      </button>
    </div>
  )
}

interface PaintingPromptBarProps {
  painting: PaintingData
  generating: boolean
  leadingActions?: ReactNode
  onPromptChange: (value: string) => void
  onGenerate: () => void
  onInputFilesChange: (files: FileEntry[]) => void
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>
}

const PaintingPromptBar: FC<PaintingPromptBarProps> = ({
  painting,
  generating,
  leadingActions,
  onPromptChange,
  onGenerate,
  onInputFilesChange,
  onKeyDown
}) => {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputFiles = useMemo(() => painting.inputFiles ?? [], [painting.inputFiles])

  const { models } = useModels(painting.providerId ? { providerId: painting.providerId } : undefined)
  const acceptsImageInput = useMemo(() => {
    if (!painting.model) return false
    const current = models.find((model) => model.apiModelId === painting.model)
    return current ? isEditImageModel(current) : false
  }, [models, painting.model])

  const appendFiles = useCallback(
    async (files: Iterable<File>) => {
      const entries = await filesToImageEntries(files)
      if (entries.length === 0) return
      onInputFilesChange([...inputFiles, ...entries])
    },
    [inputFiles, onInputFilesChange]
  )

  const removeFile = useCallback(
    (id: string) => {
      onInputFilesChange(inputFiles.filter((entry) => entry.id !== id))
    },
    [inputFiles, onInputFilesChange]
  )

  const handleDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      if (generating || !acceptsImageInput) return
      if (e.dataTransfer.files.length > 0) await appendFiles(e.dataTransfer.files)
    },
    [acceptsImageInput, appendFiles, generating]
  )

  const { isDragging, handleDragEnter, handleDragLeave, handleDragOver, handleDrop: onDrop } = useDrag(handleDrop)

  const handlePaste = useCallback(
    async (e: ClipboardEvent<HTMLTextAreaElement>) => {
      if (generating || !acceptsImageInput) return
      const files = e.clipboardData?.files
      if (!files || files.length === 0) return
      const hasImage = [...files].some((f) => f.type.startsWith(IMAGE_MIME_PREFIX))
      if (!hasImage) return
      e.preventDefault()
      await appendFiles(files)
    },
    [acceptsImageInput, appendFiles, generating]
  )

  const handlePickClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handlePickChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (files && files.length > 0) await appendFiles(files)
      e.target.value = ''
    },
    [appendFiles]
  )

  return (
    <div className="flex w-full min-w-0 shrink-0 flex-col">
      <div
        className={cn(
          'relative flex w-full min-w-0 flex-col rounded-[1.25rem] border bg-background transition-colors',
          isDragging ? 'border-primary' : 'border-border'
        )}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={onDrop}>
        {acceptsImageInput && inputFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3.5 pt-3">
            {inputFiles.map((entry) => (
              <InputFileThumbnail
                key={entry.id}
                entry={entry}
                onRemove={() => removeFile(entry.id)}
                removeLabel={t('common.delete')}
              />
            ))}
          </div>
        )}
        <Textarea.Input
          disabled={generating}
          value={painting.prompt || ''}
          spellCheck={false}
          className={cn(
            'min-h-19 flex-1 resize-none border-0 bg-transparent px-4 pt-3 pb-1.5 text-foreground/85 text-sm shadow-none',
            'placeholder:text-muted-foreground/55 focus-visible:ring-0'
          )}
          placeholder={t('paintings.prompt_placeholder')}
          onValueChange={onPromptChange}
          onKeyDown={onKeyDown}
          onPaste={handlePaste}
        />
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-3.5 pt-2 pb-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {acceptsImageInput && (
              <>
                <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={handlePickChange} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 rounded-full text-muted-foreground hover:text-foreground"
                  disabled={generating}
                  onClick={handlePickClick}
                  aria-label={t('paintings.button.select.image')}>
                  <Plus className="size-4" />
                </Button>
              </>
            )}
            {leadingActions}
          </div>
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <SendMessageButton sendMessage={onGenerate} disabled={generating} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default PaintingPromptBar
