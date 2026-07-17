import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { FileTextLineEnding, UnsupportedFileTextReason } from '@renderer/utils/fileTextSnapshot'
import { decodeFileText, encodeFileText, UnsupportedFileTextError } from '@renderer/utils/fileTextSnapshot'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { FilePath, FileVersion } from '@shared/types/file'
import { debounce } from 'es-toolkit/compat'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR, { useSWRConfig } from 'swr'

const logger = loggerService.withContext('useFileEditSession')

const AUTOSAVE_DEBOUNCE_MS = 800

/** Bound on rebase-and-retry rounds within one write loop (pathological touch loops). */
const MAX_STALE_REBASES = 3

/** Largest file we load into memory for editing. */
export const FILE_EDIT_MAX_SIZE_BYTES = 2 * 1024 * 1024

export type { UnsupportedFileTextReason } from '@renderer/utils/fileTextSnapshot'

const keyOf = (path: FilePath) => `file-edit-session/${path}`

/** A disk snapshot decoded for editing — the SWR-cached value for a path. */
interface FileEditSnapshot {
  content: string
  contentHash: string
  version: FileVersion
  lineEnding: FileTextLineEnding
  hasBom: boolean
}

/**
 * The mutable per-file edit model (VS Code's TextFileEditorModel shape). Held
 * behind a ref and captured by reference into async writers, so a write that
 * outlives a file switch still rebases/settles against ITS OWN baseline —
 * never against the next file's React state.
 *
 * Invariant: `snapshot.content` is the last content known to be on disk;
 * `draft !== snapshot.content` ⇔ dirty.
 */
interface FileEditModel {
  readonly path: FilePath
  snapshot: FileEditSnapshot
  draft: string
  conflict: boolean
  /** Serialized writer: at most one write loop runs per model at a time. */
  chain: Promise<void>
  writeRunning: boolean
}

export interface FileEditSession {
  status: 'idle' | 'loading' | 'ready' | 'unsupported' | 'error'
  /** Last content known to be on disk (feeds an uncontrolled editor on load/reload). */
  savedContent: string
  /** Current editable content (the controlled editor value). */
  draft: string
  isDirty: boolean
  isSaving: boolean
  /** A genuine external change collided with local edits — autosave is paused until `reload`. */
  conflict: boolean
  unsupportedReason?: UnsupportedFileTextReason
  error?: Error
  setDraft: (next: string) => void
  /** Discard local edits, load disk content, resume autosave. */
  reload: () => Promise<void>
  /** Write the pending edit immediately (e.g. before a file operation). */
  flush: () => Promise<void>
  /**
   * A watcher observed a change on this file. Pass the event's mtime (ms) when
   * available so a self-save echo is dismissed without any IPC. Dirty models are
   * never reloaded (VS Code semantics) — a real external change surfaces at the
   * next autosave through the optimistic write's version check.
   */
  notifyExternalChange: (eventMtimeMs?: number) => void
}

async function readSnapshot(path: FilePath): Promise<FileEditSnapshot> {
  const { content, contentHash, version } = await ipcApi.request('file.read_snapshot', { path })
  if (content.byteLength > FILE_EDIT_MAX_SIZE_BYTES) throw new UnsupportedFileTextError('size')
  const decoded = decodeFileText(content)
  return { content: decoded.content, contentHash, version, lineEnding: decoded.lineEnding, hasBom: decoded.hasBom }
}

/**
 * FileVersion.mtime is floored ms; whole-second values (`% 1000 === 0`) are how
 * second-precision filesystems (FAT32/SMB/NFS) surface, where equal mtimes do
 * not prove equal content. Mirrors main's ambiguity predicate in
 * `atomicWriteIfUnchanged`.
 */
const isAmbiguousMtime = (mtime: number) => mtime % 1000 === 0

/**
 * One file's edit session: SWR-backed read + debounced autosave through the
 * `file.write_if_unchanged` optimistic lock, with encoding/BOM/CRLF preserved
 * (via `fileTextSnapshot`). Pass `undefined` for no active file.
 *
 * Follows the VS Code text-file model:
 * - Writes are **serialized** — one in flight per file, later edits coalesce
 *   into the next write with the rebased baseline (no self-stale races).
 * - Watcher events **never reload a dirty model**; while idle, an event whose
 *   mtime matches our last on-disk version is a self-save echo (no IPC).
 * - **Conflict is decided at write time only**: a stale write is verified
 *   against disk (identical content → adopt; metadata-only touch → rebase and
 *   retry) before pausing autosave and surfacing the reload dialog.
 *
 * The hook holds one path's state, so call it at a level stable across the
 * consuming view's remounts.
 */
export function useFileEditSession(path: FilePath | undefined): FileEditSession {
  const { mutate } = useSWRConfig()
  const { data, error, isLoading } = useSWR<FileEditSnapshot, Error>(
    path ? keyOf(path) : null,
    () => readSnapshot(path!),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      errorRetryCount: 0
    }
  )

  const [draft, setDraftState] = useState('')
  const [savedContent, setSavedContentState] = useState('')
  const [conflict, setConflictState] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [ready, setReady] = useState(false)

  const modelRef = useRef<FileEditModel | null>(null)

  // Mirror a model into React state — only while it is still the active model.
  const syncFromModel = useCallback((model: FileEditModel) => {
    if (modelRef.current !== model) return
    setDraftState(model.draft)
    setSavedContentState(model.snapshot.content)
    setConflictState(model.conflict)
    setReady(true)
  }, [])

  // The write loop is rebuilt every render (capturing the current `mutate`) but
  // invoked through a ref so the stable `requestWrite` never goes stale.
  const runWritesRef = useRef<(model: FileEditModel) => Promise<void>>(undefined)
  runWritesRef.current = async (model) => {
    let rebases = 0
    if (modelRef.current === model) setIsSaving(true)
    try {
      // Re-reads `model.draft` every round: edits made while a write was in
      // flight coalesce into one follow-up write with the rebased baseline.
      while (!model.conflict && model.draft !== model.snapshot.content) {
        const writeDraft = model.draft
        const baseline = model.snapshot
        try {
          const encoded = encodeFileText(writeDraft, baseline.lineEnding, baseline.hasBom)
          const { contentHash, version } = await ipcApi.request('file.write_if_unchanged', {
            path: model.path,
            data: encoded,
            expectedVersion: baseline.version,
            expectedContentHash: baseline.contentHash
          })
          model.snapshot = { ...baseline, content: writeDraft, contentHash, version }
          syncFromModel(model)
          // Keep the SWR cache in step so a later reopen sees the saved bytes.
          void mutate(keyOf(model.path), model.snapshot, { revalidate: false })
        } catch (writeError) {
          if (!(writeError instanceof IpcError) || writeError.code !== fileErrorCodes.STALE_VERSION) {
            logger.error('Autosave failed', writeError as Error)
            break // IO error: stop; the next keystroke re-triggers the writer
          }
          // Stale write — verify against disk before declaring a conflict
          // (VS Code's validateWriteFile content-equality escape).
          try {
            const disk = await readSnapshot(model.path)
            if (disk.content === writeDraft) {
              // Disk already holds exactly what we tried to write.
              model.snapshot = disk
              syncFromModel(model)
              void mutate(keyOf(model.path), disk, { revalidate: false })
              continue
            }
            if (disk.content === baseline.content && ++rebases <= MAX_STALE_REBASES) {
              // Metadata-only touch (mtime advanced, content identical) —
              // rebase onto the new version and retry the write.
              model.snapshot = disk
              void mutate(keyOf(model.path), disk, { revalidate: false })
              continue
            }
            model.conflict = true
            syncFromModel(model)
          } catch (verifyError) {
            logger.error('Stale-write verification failed', verifyError as Error)
            model.conflict = true
            syncFromModel(model)
          }
        }
      }
    } finally {
      if (modelRef.current === model) setIsSaving(false)
    }
  }

  // TaskSequentializer-lite: one running write loop per model; a request while
  // one runs is a no-op because the loop re-reads the latest draft each round.
  const requestWrite = useCallback((model: FileEditModel) => {
    if (model.writeRunning || model.conflict) return
    model.writeRunning = true
    model.chain = (async () => {
      try {
        await runWritesRef.current?.(model)
      } finally {
        model.writeRunning = false
      }
    })()
  }, [])

  const debouncedWrite = useMemo(
    () => debounce((model: FileEditModel) => requestWrite(model), AUTOSAVE_DEBOUNCE_MS),
    [requestWrite]
  )

  // Adopt SWR data: first load creates the model; a later revalidation only
  // applies when idle, deduped by hash and guarded by mtime monotonicity.
  useEffect(() => {
    if (!data || !path) return
    const model = modelRef.current
    if (model?.path === path) {
      if (data.contentHash === model.snapshot.contentHash) return
      if (model.draft !== model.snapshot.content) return // never clobber a dirty model
      if (data.version.mtime < model.snapshot.version.mtime) return // stale read
      model.snapshot = data
      model.draft = data.content
      syncFromModel(model)
      return
    }
    const next: FileEditModel = {
      path,
      snapshot: data,
      draft: data.content,
      conflict: false,
      chain: Promise.resolve(),
      writeRunning: false
    }
    modelRef.current = next
    syncFromModel(next)
  }, [data, path, syncFromModel])

  // Path switch / unmount: hand the leaving model its final write (serialized
  // on its own chain, against its own rebased baseline — safe even if a write
  // is still in flight), then detach it and reset the mirrors.
  useEffect(() => {
    return () => {
      debouncedWrite.cancel()
      const model = modelRef.current
      if (model && !model.conflict && model.draft !== model.snapshot.content) {
        requestWrite(model)
      }
      modelRef.current = null
      setDraftState('')
      setSavedContentState('')
      setConflictState(false)
      setIsSaving(false)
      setReady(false)
    }
  }, [path, debouncedWrite, requestWrite])

  const setDraft = useCallback(
    (next: string) => {
      const model = modelRef.current
      if (!model) return
      model.draft = next
      setDraftState(next)
      debouncedWrite(model)
    },
    [debouncedWrite]
  )

  const reload = useCallback(async () => {
    const model = modelRef.current
    if (!model) return
    debouncedWrite.cancel()
    await model.chain
    const disk = await readSnapshot(model.path)
    if (modelRef.current !== model) return
    model.snapshot = disk
    model.draft = disk.content
    model.conflict = false
    syncFromModel(model)
    void mutate(keyOf(model.path), disk, { revalidate: false })
  }, [debouncedWrite, mutate, syncFromModel])

  const flush = useCallback(async () => {
    const model = modelRef.current
    debouncedWrite.cancel()
    if (!model) return
    requestWrite(model)
    await model.chain
  }, [debouncedWrite, requestWrite])

  const notifyExternalChange = useCallback(
    (eventMtimeMs?: number) => {
      const model = modelRef.current
      if (!model) return
      // Never reload a dirty model from a watcher event — a genuine external
      // change surfaces at the next autosave via the write's version check.
      if (model.draft !== model.snapshot.content) return
      // Self-save echo fast path (etag equivalent): the event carries the same
      // mtime our last write/read produced → nothing changed on disk. Skipped
      // for whole-second mtimes where equality does not prove identity.
      if (eventMtimeMs !== undefined) {
        const floored = Math.floor(eventMtimeMs)
        if (floored === model.snapshot.version.mtime && !isAmbiguousMtime(floored)) return
      }
      void (async () => {
        try {
          const disk = await readSnapshot(model.path)
          if (modelRef.current !== model) return
          if (model.draft !== model.snapshot.content) return // became dirty meanwhile
          if (disk.version.mtime < model.snapshot.version.mtime) return // stale read (monotonic guard)
          if (disk.contentHash === model.snapshot.contentHash) {
            // Content unchanged — just advance the version baseline quietly.
            model.snapshot = disk
            return
          }
          model.snapshot = disk
          model.draft = disk.content
          syncFromModel(model)
          void mutate(keyOf(model.path), disk, { revalidate: false })
        } catch (reloadError) {
          logger.error('External-change reload failed', reloadError as Error)
        }
      })()
    },
    [mutate, syncFromModel]
  )

  return useMemo(() => {
    let status: FileEditSession['status']
    let unsupportedReason: UnsupportedFileTextReason | undefined
    if (!path) {
      status = 'idle'
    } else if (error instanceof UnsupportedFileTextError) {
      status = 'unsupported'
      unsupportedReason = error.reason
    } else if (error) {
      status = 'error'
    } else if (!ready || isLoading) {
      status = 'loading'
    } else {
      status = 'ready'
    }

    return {
      status,
      savedContent,
      draft,
      isDirty: draft !== savedContent,
      isSaving,
      conflict,
      unsupportedReason,
      error: error && !(error instanceof UnsupportedFileTextError) ? error : undefined,
      setDraft,
      reload,
      flush,
      notifyExternalChange
    }
  }, [
    path,
    error,
    ready,
    isLoading,
    savedContent,
    draft,
    isSaving,
    conflict,
    setDraft,
    reload,
    flush,
    notifyExternalChange
  ])
}
