import { createContext, use, useEffect, useMemo, type FC, type ReactNode } from 'react'

import { useCache } from '@data/hooks/useCache'
import { registerNotesEditFlush, useNotesEditsLockedForRelocation } from '@renderer/hooks/notesFileEditFlush'
import { FileEditSessionContext, type FileEditSession, useFileEditSession } from '@renderer/hooks/useFileEditSession'
import { createFilePathHandle } from '@shared/utils/file'

/**
 * Session owner for every notes edit session. Matches the ownerId NotesPage
 * already passes to `useFileEditSession` on main, so a notes file shares one
 * manager session however it is opened, and `drainOwner(NOTES_FILE_EDIT_OWNER_ID)`
 * covers all of them.
 */
export const NOTES_FILE_EDIT_OWNER_ID = 'notes'

const NotesFileEditSessionContext = createContext<FileEditSession | null>(null)

/**
 * Notes-wide edit session over the window's FileEditSessionManager. Must be
 * mounted inside `FileEditSessionProvider` (both notes-capable windows).
 *
 * While the relocation lock is held, autosave is deferred but edits keep
 * flowing into the draft: the flush listener captures them (pending pastes,
 * pre-flush text pulls) before the manager seals and drains fail-closed.
 */
export const NotesFileEditSessionProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const manager = use(FileEditSessionContext)
  if (!manager) throw new Error('Notes file editing requires a window session provider')
  const [activeFilePath] = useCache('notes.active_file_path')
  const activeFileHandle = useMemo(
    () => (activeFilePath ? createFilePathHandle(activeFilePath) : undefined),
    [activeFilePath]
  )
  const editsLockedForRelocation = useNotesEditsLockedForRelocation()
  const session = useFileEditSession(activeFileHandle, NOTES_FILE_EDIT_OWNER_ID, {
    autoSave: !editsLockedForRelocation
  })

  // Registered (not called directly) so non-context callers such as
  // NotesSettings reach the same fail-closed drain through flushAllNotesEdits.
  // The drain seals only after flushAllNotesEdits has captured live editor text,
  // and stays sealed until the listener releases it on migrate_complete.
  useEffect(() => registerNotesEditFlush(() => manager.drainOwner(NOTES_FILE_EDIT_OWNER_ID)), [manager])

  return <NotesFileEditSessionContext value={session}>{children}</NotesFileEditSessionContext>
}

export function useNotesFileEditSession(): FileEditSession {
  const session = use(NotesFileEditSessionContext)
  if (!session) {
    throw new Error('useNotesFileEditSession must be used within NotesFileEditSessionProvider')
  }
  return session
}
