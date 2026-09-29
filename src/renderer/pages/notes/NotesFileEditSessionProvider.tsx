import { createContext, useContext, useEffect, useMemo, type FC, type ReactNode } from 'react'

import { useCache } from '@data/hooks/useCache'
import { type FileEditSession, useFileEditSession } from '@renderer/hooks/useFileEditSession'
import { registerNotesEditFlush } from '@renderer/services/notesEditFlush'
import { createFilePathHandle } from '@shared/utils/file'

const NotesFileEditSessionContext = createContext<FileEditSession | null>(null)

export const NotesFileEditSessionProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [activeFilePath] = useCache('notes.active_file_path')
  const activeFileHandle = useMemo(
    () => (activeFilePath ? createFilePathHandle(activeFilePath) : undefined),
    [activeFilePath]
  )
  const session = useFileEditSession(activeFileHandle)

  useEffect(() => registerNotesEditFlush(session.flush), [session.flush])

  return (
    <NotesFileEditSessionContext.Provider value={session}>{children}</NotesFileEditSessionContext.Provider>
  )
}

export function useNotesFileEditSession(): FileEditSession {
  const session = useContext(NotesFileEditSessionContext)
  if (!session) {
    throw new Error('useNotesFileEditSession must be used within NotesFileEditSessionProvider')
  }
  return session
}
