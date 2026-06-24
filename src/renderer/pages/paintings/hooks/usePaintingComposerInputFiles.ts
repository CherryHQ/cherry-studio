import { loggerService } from '@logger'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { createComposerFileTokenSourceId } from '@renderer/utils/message/composerFileTokenSource'
import type { FileEntry } from '@shared/data/types/file/fileEntry'
import type { FilePath } from '@shared/types/file/common'
import { getFileTypeByExt } from '@shared/utils/file/fileType'
import { type Dispatch, type SetStateAction, useEffect, useRef } from 'react'

const logger = loggerService.withContext('usePaintingComposerInputFiles')

interface Params {
  paintingId: string
  inputFiles: FileEntry[]
  files: ComposerAttachment[]
  setFiles: Dispatch<SetStateAction<ComposerAttachment[]>>
  onInputFilesChange: (files: FileEntry[]) => void
}

const withDot = (ext: string | null | undefined): string => {
  if (!ext) return ''
  return ext.startsWith('.') ? ext : `.${ext}`
}

/**
 * Bridges the composer's v1-style `ComposerAttachment` file state to the painting
 * page's v2 `FileEntry[]` input files (the composer attachment pipeline predates
 * the v2 FileEntry layer — see composerAttachment.ts).
 *
 * - SEED: when the painting changes, project its `inputFiles` onto composer
 *   attachments so existing input images render as file chips, and prime the
 *   source-id→entry cache so the writeback recognises them as unchanged.
 * - WRITEBACK: when composer attachments change (added via picker/paste/drop,
 *   removed via file-token deletion), promote each attachment to a `FileEntry`
 *   (`createInternalEntry source:'path'`, cached by token source id so the same
 *   attachment never re-imports its bytes) and report the new list — but only
 *   after the seed has run, so the pre-seed empty list never wipes a painting
 *   that has input files.
 */
export function usePaintingComposerInputFiles({ paintingId, inputFiles, files, setFiles, onInputFilesChange }: Params) {
  const entryCacheRef = useRef(new Map<string, FileEntry>())
  const seededPaintingIdRef = useRef<string | null>(null)
  const seedCompleteRef = useRef(false)
  const writebackEpochRef = useRef(0)
  const onInputFilesChangeRef = useRef(onInputFilesChange)
  onInputFilesChangeRef.current = onInputFilesChange
  const inputFilesRef = useRef(inputFiles)
  inputFilesRef.current = inputFiles

  // SEED — once per painting.
  useEffect(() => {
    if (seededPaintingIdRef.current === paintingId) return
    seededPaintingIdRef.current = paintingId
    seedCompleteRef.current = false

    const entries = inputFilesRef.current
    if (entries.length === 0) {
      entryCacheRef.current = new Map()
      setFiles([])
      seedCompleteRef.current = true
      return
    }

    let cancelled = false
    void (async () => {
      const cache = new Map<string, FileEntry>()
      const attachments: ComposerAttachment[] = []
      for (const entry of entries) {
        try {
          const path = await window.api.file.getPhysicalPath({ id: entry.id })
          const sourceId = createComposerFileTokenSourceId()
          cache.set(sourceId, entry)
          attachments.push({
            fileTokenSourceId: sourceId,
            path,
            name: entry.name,
            origin_name: entry.name,
            ext: withDot(entry.ext),
            size: 'size' in entry ? (entry.size ?? 0) : 0,
            type: getFileTypeByExt(entry.ext ?? '')
          })
        } catch (error) {
          logger.error('failed to seed composer attachment from input file', error as Error)
        }
      }
      if (cancelled) return
      entryCacheRef.current = cache
      setFiles(attachments)
      seedCompleteRef.current = true
    })()

    return () => {
      cancelled = true
    }
  }, [paintingId, setFiles])

  // WRITEBACK — on attachment change, after the seed has run.
  useEffect(() => {
    if (seededPaintingIdRef.current !== paintingId || !seedCompleteRef.current) return
    const epoch = ++writebackEpochRef.current
    let cancelled = false

    void (async () => {
      const cache = entryCacheRef.current
      const entries: FileEntry[] = []
      for (const file of files) {
        const cached = cache.get(file.fileTokenSourceId)
        if (cached) {
          entries.push(cached)
          continue
        }
        try {
          const entry = await window.api.file.createInternalEntry({ source: 'path', path: file.path as FilePath })
          cache.set(file.fileTokenSourceId, entry)
          entries.push(entry)
        } catch (error) {
          logger.error('failed to create input file entry from composer attachment', error as Error)
        }
      }
      if (cancelled || epoch !== writebackEpochRef.current) return

      const nextIds = entries.map((entry) => entry.id)
      const currentIds = inputFilesRef.current.map((entry) => entry.id)
      const unchanged = nextIds.length === currentIds.length && nextIds.every((id, index) => id === currentIds[index])
      if (!unchanged) onInputFilesChangeRef.current(entries)
    })()

    return () => {
      cancelled = true
    }
  }, [files, paintingId])
}
