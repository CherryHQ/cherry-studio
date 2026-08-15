import { loggerService } from '@logger'
import { toast } from '@renderer/services/toast'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { createComposerFileTokenSourceId } from '@renderer/utils/message/composerFileTokenSource'
import type { FileEntry, FileEntryId } from '@shared/data/types/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { getFileTypeByExt } from '@shared/utils/file'
import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('usePaintingComposerInputFiles')

/**
 * Whether the current model accepts image inputs. `'unknown'` while the model is
 * still resolving from the async catalog — treated as "don't touch the draft" so a
 * load blip never clears valid chips (see the CLEAR effect).
 */
export type InputCapability = 'unknown' | 'accept' | 'reject'

interface Params {
  paintingId: string
  inputFiles: FileEntry[]
  files: ComposerAttachment[]
  setFiles: Dispatch<SetStateAction<ComposerAttachment[]>>
  /** Resolved-model image-input capability; drives the model-switch draft clear. */
  inputCapability: InputCapability
  /** Provider of the current painting; a change means switchModel reset the context. */
  providerId: string | undefined
}

const withDot = (ext: string | null | undefined): string => {
  if (!ext) return ''
  return ext.startsWith('.') ? ext : `.${ext}`
}

/**
 * Existence probe for a cached entry id. `getPhysicalPath` resolves through
 * `fileEntryService.getById`, so a reclaimed row rejects — the same signal the
 * SEED path already relies on. Reused deliberately rather than adding an IPC
 * route for a question an existing one already answers.
 */
async function entryStillExists(id: FileEntryId): Promise<boolean> {
  try {
    await window.api.file.getPhysicalPath({ id })
    return true
  } catch {
    return false
  }
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
 *   bytes) and returns the resolved list plus a `complete` flag. Nothing is written
 *   to the DB during the draft window, so the cleanup reaper has no unreferenced
 *   input row to reclaim. Contract: an incomplete set (`complete: false`, some
 *   attachment failed to promote) must never reach generation — the caller aborts.
 * - CLEAR: a same-painting model switch does NOT remount the composer (the provider
 *   is keyed on painting id only), so SEED never re-runs to reconcile `switchModel`
 *   dropping `inputFiles`. This effect is that reconciliation: switching to a model
 *   that can't accept images (`accept`→`reject`) or to a different provider clears
 *   the draft, mirroring `switchModel`'s `inputFiles: []`. It does NOT rely on the
 *   stale `painting.inputFiles === files` assumption the removed writeback used to
 *   uphold.
 *
 * SEED and CLEAR are separate effects racing over the same draft, so both go through
 * `draftEpochRef`: CLEAR bumps it, SEED refuses to commit results from a superseded
 * epoch. See the ref's own comment for the failure it prevents.
 *
 * Note the draft is *only* the next request's inputs. `painting.inputFiles` is the
 * archive of the run that produced `painting.files`; SEED projects it into the tray
 * as a starting point, and nothing writes back to it outside `generate`.
 */
export function usePaintingComposerInputFiles({
  paintingId,
  inputFiles,
  files,
  setFiles,
  inputCapability,
  providerId
}: Params) {
  const { t } = useTranslation()
  const entryCacheRef = useRef(new Map<string, FileEntry>())
  // Input files that failed to resolve to a physical path during SEED: they get no
  // composer chip, but must survive materialization so a transient read error never
  // shrinks the input list handed to generation (see materializeInputs).
  const unseededEntriesRef = useRef<FileEntry[]>([])
  const seededPaintingIdRef = useRef<string | null>(null)
  // Draft generation counter. Every event that discards the current draft bumps it,
  // so an in-flight SEED can tell its results are stale before writing them back.
  // An effect-local `cancelled` flag is not enough: it is only flipped by SEED's own
  // cleanup (painting change / unmount), while CLEAR lives in a *separate* effect —
  // so a SEED still awaiting `getPhysicalPath` when the user switched models would
  // resolve afterwards and restore the very chips CLEAR just dropped, handing images
  // to a model or provider that should never have seen them.
  const draftEpochRef = useRef(0)
  const inputFilesRef = useRef(inputFiles)
  inputFilesRef.current = inputFiles
  const filesRef = useRef(files)
  filesRef.current = files
  // CLEAR bookkeeping: last *resolved* capability (ignores 'unknown' load blips) and
  // the last provider, to detect the model-switch transitions that drop the draft.
  const lastCapabilityRef = useRef<'accept' | 'reject' | null>(null)
  const lastProviderIdRef = useRef<string | undefined>(providerId)

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

    const epoch = draftEpochRef.current
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
      if (draftEpochRef.current !== epoch) return
      entryCacheRef.current = cache
      unseededEntriesRef.current = unseeded
      setFiles(attachments)
    })()

    return () => {
      draftEpochRef.current++
    }
  }, [paintingId, setFiles])

  // CLEAR — reconcile a same-painting model switch (which does NOT remount, so SEED
  // never re-runs). See the hook docs. A different painting id remounts this hook
  // fresh, so the refs re-initialize and neither branch fires spuriously on mount.
  useEffect(() => {
    const providerChanged = lastProviderIdRef.current !== providerId
    lastProviderIdRef.current = providerId

    const droppedImageSupport = lastCapabilityRef.current === 'accept' && inputCapability === 'reject'
    // 'unknown' (catalog still loading) carries the last resolved capability forward,
    // so a load blip between two edit models never looks like a support drop.
    if (inputCapability !== 'unknown') lastCapabilityRef.current = inputCapability

    if (!providerChanged && !droppedImageSupport) return

    // Bump first: a SEED still awaiting `getPhysicalPath` must lose the right to
    // write back, or it would undo this clear the moment it resolves.
    draftEpochRef.current++
    entryCacheRef.current = new Map()
    unseededEntriesRef.current = []
    setFiles([])
  }, [inputCapability, providerId, setFiles])

  // MATERIALIZE — at generate time. Promote the current composer attachments to
  // FileEntry[]; a cache hit (seeded, or promoted earlier this session) is reused,
  // a miss is imported via `createInternalEntry`.
  const materializeInputs = useCallback(async (): Promise<{ entries: FileEntry[]; complete: boolean }> => {
    const cache = entryCacheRef.current
    const entries: FileEntry[] = []
    const failedSourceIds: string[] = []
    for (const file of filesRef.current) {
      const cached = cache.get(file.fileTokenSourceId)
      // A cached id is not proof the row still exists. Materialized entries are
      // `delete_when_unreferenced`, and any send that ends before `generate`
      // persists the painting refs leaves them zero-referenced — an aborted
      // incomplete set is exactly that. The cleanup pass then reclaims them
      // correctly, and the cache would go on handing out a dead id, which
      // `PaintingService` silently drops from the refs: the chip stays visible
      // while its image vanishes from the generation. Probe before trusting it,
      // and fall through to a fresh import when it is gone.
      if (cached && (await entryStillExists(cached.id))) {
        entries.push(cached)
        continue
      }
      if (cached) {
        cache.delete(file.fileTokenSourceId)
        logger.info('input entry was reclaimed since it was cached; re-importing', {
          entryId: cached.id
        })
      }
      try {
        const entry = await window.api.file.createInternalEntry({
          source: 'path',
          path: AbsoluteFilePathSchema.parse(file.path),
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
    // that, so drop the chip, tell the user, and report the set as incomplete — the
    // caller must abort the send rather than generate without the image (mirrors
    // chat aborting when buildFileParts rejects). The chip is the only feedback
    // channel; the toast tells the user to re-add it.
    if (failedSourceIds.length > 0) {
      const failed = new Set(failedSourceIds)
      setFiles((prev) => prev.filter((file) => !failed.has(file.fileTokenSourceId)))
      toast.error(t('paintings.image_file_retry'))
    }

    // Carry through inputs that failed to seed (transient read error) so they are
    // not silently dropped from the generation; they land at the tail. A seed
    // failure is not a promote failure — those entries already exist and stay
    // complete.
    const preserved = unseededEntriesRef.current
    return {
      entries: preserved.length ? [...entries, ...preserved] : entries,
      complete: failedSourceIds.length === 0
    }
  }, [setFiles, t])

  return { materializeInputs }
}
