import { createContext, use, useEffect, useMemo, type FC, type ReactNode } from 'react'

import { useCache } from '@data/hooks/useCache'
import { type FileEditSession, useFileEditSession } from '@renderer/hooks/useFileEditSession'
import { notesEditFlushService } from '@renderer/services/NotesEditFlushService'
import { createFilePathHandle } from '@shared/utils/file'

const NotesFileEditSessionContext = createContext<FileEditSession | null>(null)

export const NotesFileEditSessionProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [activeFilePath] = useCache('notes.active_file_path')
  const activeFileHandle = useMemo(
    () => (activeFilePath ? createFilePathHandle(activeFilePath) : undefined),
    [activeFilePath]
  )
  const session = useFileEditSession(activeFileHandle)

  useEffect(() => notesEditFlushService.register(session.flush), [session.flush])

  return <NotesFileEditSessionContext value={session}>{children}</NotesFileEditSessionContext>
}

export function useNotesFileEditSession(): FileEditSession {
  const session = use(NotesFileEditSessionContext)
  if (!session) {
    throw new Error('useNotesFileEditSession must be used within NotesFileEditSessionProvider')
  }
  return session
}
