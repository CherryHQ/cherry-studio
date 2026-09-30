import {
  createContext,
  use,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type FC,
  type ReactNode
} from 'react'

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

  useIpcOn('app.notes_relocation.migration_started', () => {
    notesEditFlushService.beginMigrationLock()
  })
  useIpcOn('app.notes_relocation.migration_finished', () => {
    notesEditFlushService.endMigrationLock()
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
