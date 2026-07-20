import { loggerService } from '@logger'
import { toast } from '@renderer/services/toast'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { createComposerFileTokenSourceId } from '@renderer/utils/message/composerFileTokenSource'
import type { FileEntry } from '@shared/data/types/file'
import type { FilePath } from '@shared/types/file'
import { getFileTypeByExt } from '@shared/utils/file'
import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('usePaintingComposerInputFiles')

interface Params {
  paintingId: string
  inputFiles: FileEntry[]
  files: ComposerAttachment[]
  setFiles: Dispatch<SetStateAction<ComposerAttachment[]>>
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
 *   source-id→entry cache so a re-opened input maps back to its existing entry.
 * - MATERIALIZE: `materializeInputs()` is called at generate time (mirroring chat's
 *   send-time `buildFileParts`), NOT eagerly during the draft. It promotes each
 *   composer attachment to a `FileEntry` (`createInternalEntry source:'path'`,
 *   cached by token source id so a seeded/promoted attachment never re-imports its
 *   bytes) and returns the resolved list. Nothing is written to the DB during the
 *   draft window, so the cleanup reaper has no unreferenced input row to reclaim.
 */
export function usePaintingComposerInputFiles({ paintingId, inputFiles, files, setFiles }: Params) {
  const { t } = useTranslation()
  const entryCacheRef = useRef(new Map<string, FileEntry>())
  // Input files that failed to resolve to a physical path during SEED: they get no
  // composer chip, but must survive materialization so a transient read error never
  // shrinks the input list handed to generation (see materializeInputs).
  const unseededEntriesRef = useRef<FileEntry[]>([])
  const seededPaintingIdRef = useRef<string | null>(null)
  const inputFilesRef = useRef(inputFiles)
  inputFilesRef.current = inputFiles
  const filesRef = useRef(files)
  filesRef.current = files

  // SEED — once per painting.
  useEffect(() => {
    if (seededPaintingIdRef.current === paintingId) return
    seededPaintingIdRef.current = paintingId
    unseededEntriesRef.current = []

    const entries = inputFilesRef.current
    if (entries.length === 0) {
      entryCacheRef.current = new Map()
      setFiles([])
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
    })()

    return () => {
      cancelled = true
    }
  }, [paintingId, setFiles])

  // MATERIALIZE — at generate time. Promote the current composer attachments to
  // FileEntry[]; a cache hit (seeded, or promoted earlier this session) is reused,
  // a miss is imported via `createInternalEntry`.
  const materializeInputs = useCallback(async (): Promise<FileEntry[]> => {
    const cache = entryCacheRef.current
    const entries: FileEntry[] = []
    const failedSourceIds: string[] = []
    for (const file of filesRef.current) {
      const cached = cache.get(file.fileTokenSourceId)
      if (cached) {
        entries.push(cached)
        continue
      }
      try {
        const entry = await window.api.file.createInternalEntry({
          source: 'path',
          path: file.path as FilePath,
          cleanupPolicy: 'delete_when_unreferenced'
        })
        cache.set(file.fileTokenSourceId, entry)
        entries.push(entry)
      } catch (error) {
        logger.error('failed to create input file entry from composer attachment', error as Error)
        failedSourceIds.push(file.fileTokenSourceId)
      }
    }

    // A visible chip must imply a file that reaches generation. A promote failure
    // (swept temp file, disk/IPC error on a path the renderer doesn't own) breaks
    // that, so drop the chip and tell the user instead of silently generating
    // without the image — the chip is the only feedback channel.
    if (failedSourceIds.length > 0) {
      const failed = new Set(failedSourceIds)
      setFiles((prev) => prev.filter((file) => !failed.has(file.fileTokenSourceId)))
      toast.error(t('paintings.image_file_retry'))
    }

    // Carry through inputs that failed to seed (transient read error) so they are
    // not silently dropped from the generation; they land at the tail.
    const preserved = unseededEntriesRef.current
    return preserved.length ? [...entries, ...preserved] : entries
  }, [setFiles, t])

  return { materializeInputs }
}
