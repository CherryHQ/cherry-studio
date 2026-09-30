import { createContext, use, useEffect, useMemo, type FC, type ReactNode } from 'react'

import { useCache } from '@data/hooks/useCache'
import { areNotesEditsLockedForRelocation, registerNotesEditFlush } from '@renderer/hooks/notesFileEditFlush'
import { type FileEditSession, useFileEditSession } from '@renderer/hooks/useFileEditSession'
import { createFilePathHandle } from '@shared/utils/file'

const NotesFileEditSessionContext = createContext<FileEditSession | null>(null)

export const NotesFileEditSessionProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [activeFilePath] = useCache('notes.active_file_path')
  const activeFileHandle = useMemo(
    () => (activeFilePath ? createFilePathHandle(activeFilePath) : undefined),
    [activeFilePath]
  )
  const session = useFileEditSession(activeFileHandle)
  const guardedSession = useMemo<FileEditSession>(
    () => ({
      ...session,
      setDraft: (next: string) => {
        if (areNotesEditsLockedForRelocation()) {
          return
        }
        session.setDraft(next)
      }
    }),
    [session]
  )

  useEffect(() => registerNotesEditFlush(session.flush), [session.flush])

  return <NotesFileEditSessionContext value={guardedSession}>{children}</NotesFileEditSessionContext>
}

export function useNotesFileEditSession(): FileEditSession {
  const session = use(NotesFileEditSessionContext)
  if (!session) {
    throw new Error('useNotesFileEditSession must be used within NotesFileEditSessionProvider')
  }
  return session
}
