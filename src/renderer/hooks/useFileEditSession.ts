import {
  createContext,
  useCallback,
  use,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from 'react'

import type {
  FileEditSessionManager,
  PreparedFileMutation,
  SessionLease
} from '@renderer/services/fileEdit/FileEditSessionManager'
import { UnsupportedFileTextError, type UnsupportedFileTextReason } from '@renderer/utils/fileTextSnapshot'
import type { FileHandle } from '@shared/data/types/file'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'

export { FILE_EDIT_MAX_SIZE_BYTES } from '@shared/types/file'
export type { UnsupportedFileTextReason } from '@renderer/utils/fileTextSnapshot'

export const FileEditSessionContext = createContext<FileEditSessionManager | null>(null)

export interface FileEditSession {
  status: 'idle' | 'loading' | 'ready' | 'unsupported' | 'error'
  sessionId?: string
  documentEpoch: number
  readOnly: boolean
  savedContent: string
  savedSizeBytes?: number
  draft: string
  isDirty: boolean
  isSaving: boolean
  conflict: boolean
  saveError?: Error
  metadataRecoveryPending: boolean
  unsupportedReason?: UnsupportedFileTextReason
  error?: Error
  setDraft(next: string): void
  discard(): Promise<void>
  reload(): Promise<void>
  keepDraft(): Promise<void>
  flush(): Promise<void>
  notifyExternalChange(): void
  prepareMutation(): Promise<PreparedFileMutation>
}

const emptySubscription = () => () => {}
const emptySnapshot = () => null
const keyOf = (handle: FileHandle) => (handle.kind === 'entry' ? `entry:${handle.entryId}` : `path:${handle.path}`)

export function useFileEditSession(
  handle: FileHandle | undefined,
  ownerId: string,
  { autoSave = true }: { autoSave?: boolean } = {}
): FileEditSession {
  const manager = use(FileEditSessionContext)
  if (!manager) throw new Error('File editing requires a window session provider')
  const entryId = handle?.kind === 'entry' ? handle.entryId : undefined
  const path = handle?.kind === 'path' ? handle.path : undefined
  const stableHandle = useMemo<FileHandle | undefined>(
    () => (entryId ? { kind: 'entry', entryId } : path ? { kind: 'path', path } : undefined),
    [entryId, path]
  )
  const key = stableHandle ? keyOf(stableHandle) : undefined
  const request = useMemo(() => ({ key, manager, ownerId }), [key, manager, ownerId])
  const [acquired, setAcquired] = useState<{ request: typeof request; lease?: SessionLease; error?: Error }>()
  useLayoutEffect(() => {
    if (!stableHandle || !key) return
    let cancelled = false
    let lease: SessionLease | undefined
    void manager.acquire(ownerId, stableHandle).then(
      (result) => {
        if (cancelled) result.release()
        else {
          lease = result
          setAcquired({ request, lease })
        }
      },
      (error: unknown) => {
        if (!cancelled) setAcquired({ request, error: error instanceof Error ? error : new Error(String(error)) })
      }
    )
    return () => {
      cancelled = true
      lease?.release()
    }
  }, [manager, ownerId, key, stableHandle, request])

  const lease = acquired?.request === request ? acquired?.lease : undefined
  const acquisitionError = acquired?.request === request ? acquired?.error : undefined
  const snapshot = useSyncExternalStore(lease?.subscribe ?? emptySubscription, lease?.getSnapshot ?? emptySnapshot)
  const activatedLease = useRef<SessionLease | undefined>(undefined)
  useEffect(() => {
    if (!lease) return
    const refresh = () => {
      void lease.invalidate()
    }
    const visible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', visible)
    if (activatedLease.current === lease) refresh()
    activatedLease.current = lease
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [lease])
  useEffect(() => {
    lease?.setAutoSave(autoSave)
  }, [lease, autoSave])
  const epoch = snapshot?.documentEpoch
  const bindingEpoch = snapshot?.bindingEpoch
  const setDraft = useCallback(
    (text: string) => {
      lease?.acceptEdit(text, epoch, bindingEpoch)
    },
    [lease, epoch, bindingEpoch]
  )
  const invoke = useCallback(
    (command: 'flush' | 'discard' | 'reload' | 'keepLocal') => {
      if (!lease) {
        if (acquisitionError && (command === 'flush' || command === 'discard')) return Promise.resolve()
        return Promise.reject(new Error('File session is not ready'))
      }
      return lease[command]()
    },
    [lease, acquisitionError]
  )

  const commands = useMemo(
    () => ({
      discard: () => invoke('discard'),
      reload: () => invoke('reload'),
      keepDraft: () => invoke('keepLocal'),
      flush: () => invoke('flush'),
      notifyExternalChange: () => {
        void lease?.invalidate()
      },
      prepareMutation: () => manager.prepareMutation()
    }),
    [invoke, manager, lease]
  )

  return useMemo(() => {
    const error = snapshot?.readError ?? acquisitionError
    const unsupportedReason =
      error instanceof UnsupportedFileTextError
        ? error.reason
        : error instanceof IpcError && error.code === fileErrorCodes.EDIT_UNSUPPORTED
          ? 'size'
          : undefined
    return {
      status: !handle ? 'idle' : unsupportedReason ? 'unsupported' : error ? 'error' : snapshot ? 'ready' : 'loading',
      sessionId: snapshot?.sessionId,
      documentEpoch: snapshot?.documentEpoch ?? 0,
      readOnly: !lease?.writable || !!snapshot?.sealed || !!snapshot?.readError,
      savedContent: snapshot?.savedContent ?? '',
      savedSizeBytes: snapshot?.savedSizeBytes,
      draft: snapshot?.draft ?? '',
      isDirty: snapshot?.isDirty ?? false,
      isSaving: snapshot?.isSaving ?? false,
      conflict: snapshot?.conflict ?? false,
      saveError: snapshot?.saveError,
      metadataRecoveryPending: snapshot?.metadataRecoveryPending ?? false,
      unsupportedReason,
      error,
      setDraft,
      ...commands
    }
  }, [acquisitionError, handle, lease, snapshot, setDraft, commands])
}
