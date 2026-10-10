import { createContext, use, useEffect, useMemo, useRef, useSyncExternalStore, type FC, type ReactNode } from 'react'

import { useCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { type FileEditSession, useFileEditSession } from '@renderer/hooks/useFileEditSession'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { notesEditFlushService } from '@renderer/services/NotesEditFlushService'
import { createFilePathHandle } from '@shared/utils/file'

const logger = loggerService.withContext('NotesFileEditSessionProvider')

const NotesFileEditSessionContext = createContext<FileEditSession | null>(null)

export const NotesFileEditSessionProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [activeFilePath] = useCache('notes.active_file_path')
  const activeFileHandle = useMemo(
    () => (activeFilePath ? createFilePathHandle(activeFilePath) : undefined),
    [activeFilePath]
  )
  const session = useFileEditSession(activeFileHandle)
  const migrationLocked = useSyncExternalStore(
    (listener) => notesEditFlushService.subscribeMigrationLock(listener),
    () => notesEditFlushService.getMigrationLocked(),
    () => false
  )

  const guardedSession = useMemo(() => {
    if (!migrationLocked) {
      return session
    }
    return {
      ...session,
      setDraft: () => {
        // Directory copy is in flight; ignore edits until migration finishes.
      }
    }
  }, [session, migrationLocked])

  useEffect(() => notesEditFlushService.register(session.flush), [session.flush])

  useEffect(() => {
    void ipcApi
      .request('app.notes_relocation.sync_state')
      .then(({ migrationLocked }) => {
        if (migrationLocked && !notesEditFlushService.getMigrationLocked()) {
          notesEditFlushService.beginMigrationLock()
        }
      })
      .catch((error) => logger.warn('Failed to sync notes migration lock state', error as Error))
  }, [])

  const pendingMigrationLockAckRef = useRef<string | null>(null)

  useIpcOn('app.notes_relocation.migration_started', ({ batchId }) => {
    const wasLocked = notesEditFlushService.getMigrationLocked()
    notesEditFlushService.beginMigrationLock()
    if (wasLocked) {
      void ipcApi
        .request('app.notes_relocation.migration_lock_ack', { batchId, ok: true })
        .catch((error) => logger.warn('Failed to acknowledge notes migration lock', error as Error))
      return
    }
    pendingMigrationLockAckRef.current = batchId
  })

  useEffect(() => {
    const batchId = pendingMigrationLockAckRef.current
    if (!migrationLocked || !batchId) {
      return
    }
    pendingMigrationLockAckRef.current = null
    void ipcApi
      .request('app.notes_relocation.migration_lock_ack', { batchId, ok: true })
      .catch((error) => logger.warn('Failed to acknowledge notes migration lock', error as Error))
  }, [migrationLocked])
  useIpcOn('app.notes_relocation.migration_finished', () => {
    notesEditFlushService.resetMigrationLock()
  })

  // Main asks every notes-capable window to persist drafts before a directory
  // migration; this window acknowledges so the migration can safely proceed.
  useIpcOn('app.notes_relocation.flush_requested', ({ batchId }) => {
    void notesEditFlushService
      .flushAll()
      .then(
        () => ipcApi.request('app.notes_relocation.flush_ack', { batchId, ok: true }),
        (error) => {
          logger.error('Failed to flush notes edits before migration', error as Error)
          return ipcApi.request('app.notes_relocation.flush_ack', { batchId, ok: false })
        }
      )
      .catch((error) => logger.warn('Failed to acknowledge notes edit flush', error as Error))
  })

  return <NotesFileEditSessionContext value={guardedSession}>{children}</NotesFileEditSessionContext>
}

export function useNotesFileEditSession(): FileEditSession {
  const session = use(NotesFileEditSessionContext)
  if (!session) {
    throw new Error('useNotesFileEditSession must be used within NotesFileEditSessionProvider')
  }
  return session
}
