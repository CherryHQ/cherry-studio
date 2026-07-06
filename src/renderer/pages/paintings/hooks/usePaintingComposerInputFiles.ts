import { loggerService } from '@logger'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { createComposerFileTokenSourceId } from '@renderer/utils/message/composerFileTokenSource'
import type { FileEntry } from '@shared/data/types/file'
import type { FilePath } from '@shared/types/file'
import { getFileTypeByExt } from '@shared/utils/file'
import { type Dispatch, type SetStateAction, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation()
  const entryCacheRef = useRef(new Map<string, FileEntry>())
  // Input files that failed to resolve to a physical path during SEED: they get no
  // composer chip, but must survive the writeback so a transient read error never
  // rewrites the persisted painting (see WRITEBACK).
  const unseededEntriesRef = useRef<FileEntry[]>([])
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
    unseededEntriesRef.current = []

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
      const unseeded: FileEntry[] = []
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
          unseeded.push(entry)
        }
      }
      if (cancelled) return
      entryCacheRef.current = cache
      unseededEntriesRef.current = unseeded
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
      const failedSourceIds: string[] = []
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
          failedSourceIds.push(file.fileTokenSourceId)
        }
      }
      if (cancelled || epoch !== writebackEpochRef.current) return

      // A visible chip must imply a file that will reach generation. A promote failure
      // (swept temp file, disk/IPC error on a path the renderer doesn't own) breaks
      // that, so drop the chip and tell the user instead of silently generating
      // without the image — the chip is the only feedback channel.
      if (failedSourceIds.length > 0) {
        const failed = new Set(failedSourceIds)
        setFiles((prev) => prev.filter((file) => !failed.has(file.fileTokenSourceId)))
        window.toast?.error(t('paintings.image_file_retry'))
      }

      // Carry through entries that failed to seed so a transient read error can't
      // shrink the persisted list. When the whole painting failed to resolve, this
      // reproduces the original list and the unchanged guard suppresses the wipe.
      // Failed entries land at the tail, so a *partial* failure persists a one-time
      // reorder on open; widen to original-order merge only if that bites.
      const preserved = unseededEntriesRef.current
      const nextEntries = preserved.length ? [...entries, ...preserved] : entries
      const nextIds = nextEntries.map((entry) => entry.id)
      const currentIds = inputFilesRef.current.map((entry) => entry.id)
      const unchanged = nextIds.length === currentIds.length && nextIds.every((id, index) => id === currentIds[index])
      if (!unchanged) onInputFilesChangeRef.current(nextEntries)
    })()

    return () => {
      cancelled = true
    }
  }, [files, paintingId])
}
