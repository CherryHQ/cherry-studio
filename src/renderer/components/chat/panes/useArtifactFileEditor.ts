import { canonicalizeAbsolutePath } from '@shared/utils/file'
import { useCallback, useMemo, useRef, useState } from 'react'

import type { ArtifactPaneFileSelection } from './artifactPanePath'

type ArtifactFileEditorMode = 'preview' | 'edit'

interface ArtifactFileEditSession {
  mode: ArtifactFileEditorMode
  status: 'loading' | 'ready' | 'saving'
  draft: string
  savedContent: string
}

interface StoredArtifactFileEditSession extends ArtifactFileEditSession {
  filePath: string
}

export interface ArtifactFileEditor {
  hasUnsavedChanges: boolean
  getSession: (selection: ArtifactPaneFileSelection) => ArtifactFileEditSession | undefined
  setMode: (selection: ArtifactPaneFileSelection, mode: ArtifactFileEditorMode) => Promise<void>
  updateDraft: (selection: ArtifactPaneFileSelection, draft: string) => void
  save: (selection: ArtifactPaneFileSelection) => Promise<void>
  discard: (selection: ArtifactPaneFileSelection) => void
  reload: (selection: ArtifactPaneFileSelection) => Promise<void>
  clear: () => void
}

function getSelectionPath(selection: ArtifactPaneFileSelection): string {
  return canonicalizeAbsolutePath(`${selection.workspacePath}/${selection.filePath}`)
}

function isDirty(session: ArtifactFileEditSession): boolean {
  return session.draft !== session.savedContent
}

/**
 * Controller for the one file currently being edited. Callers may lift this
 * hook above layout remounts, but must clear it when the preview closes or selects another file.
 */
export function useArtifactFileEditor(): ArtifactFileEditor {
  const [session, setSession] = useState<StoredArtifactFileEditSession>()
  const requestVersionRef = useRef(0)

  const clear = useCallback(() => {
    requestVersionRef.current += 1
    setSession(undefined)
  }, [])

  const getSession = useCallback(
    (selection: ArtifactPaneFileSelection) => {
      const filePath = getSelectionPath(selection)
      return session?.filePath === filePath ? session : undefined
    },
    [session]
  )

  const load = useCallback(
    async (selection: ArtifactPaneFileSelection, requestedMode?: ArtifactFileEditorMode) => {
      const filePath = getSelectionPath(selection)
      const previousSession = session?.filePath === filePath ? session : undefined
      const requestVersion = requestVersionRef.current + 1
      requestVersionRef.current = requestVersion

      setSession({
        filePath,
        mode: requestedMode ?? previousSession?.mode ?? 'preview',
        status: 'loading',
        draft: previousSession?.draft ?? '',
        savedContent: previousSession?.savedContent ?? ''
      })

      try {
        const content = await window.api.file.readExternal(filePath)
        if (requestVersionRef.current !== requestVersion) return

        setSession((current) => {
          if (current?.filePath !== filePath) return current
          return {
            filePath,
            mode: requestedMode ?? current.mode,
            status: 'ready',
            draft: content,
            savedContent: content
          }
        })
      } catch (error) {
        if (requestVersionRef.current === requestVersion) {
          setSession(previousSession)
        }
        throw error
      }
    },
    [session]
  )

  const setMode = useCallback(
    async (selection: ArtifactPaneFileSelection, mode: ArtifactFileEditorMode) => {
      const filePath = getSelectionPath(selection)
      if (mode === 'edit' && session?.filePath !== filePath) {
        await load(selection, 'edit')
        return
      }
      setSession((current) => (current?.filePath === filePath ? { ...current, mode } : current))
    },
    [load, session]
  )

  const updateDraft = useCallback((selection: ArtifactPaneFileSelection, draft: string) => {
    const filePath = getSelectionPath(selection)
    setSession((current) => (current?.filePath === filePath ? { ...current, draft } : current))
  }, [])

  const save = useCallback(
    async (selection: ArtifactPaneFileSelection) => {
      const filePath = getSelectionPath(selection)
      if (session?.filePath !== filePath || session.status !== 'ready' || !isDirty(session)) {
        return
      }

      const submittedDraft = session.draft
      const requestVersion = requestVersionRef.current + 1
      requestVersionRef.current = requestVersion
      setSession((current) => (current?.filePath === filePath ? { ...current, status: 'saving' as const } : current))

      try {
        await window.api.file.write(filePath, submittedDraft)
        if (requestVersionRef.current !== requestVersion) return

        setSession((current) => {
          if (current?.filePath !== filePath) return current
          return {
            ...current,
            status: 'ready',
            savedContent: submittedDraft
          }
        })
      } catch (error) {
        if (requestVersionRef.current === requestVersion) {
          setSession((current) => (current?.filePath === filePath ? { ...current, status: 'ready' } : current))
        }
        throw error
      }
    },
    [session]
  )

  const discard = useCallback((selection: ArtifactPaneFileSelection) => {
    const filePath = getSelectionPath(selection)
    setSession((current) => {
      if (current?.filePath !== filePath || current.status !== 'ready') return current
      return { ...current, draft: current.savedContent }
    })
  }, [])

  const reload = useCallback(
    async (selection: ArtifactPaneFileSelection) => {
      await load(selection)
    },
    [load]
  )

  return useMemo(
    () => ({
      hasUnsavedChanges: session ? isDirty(session) : false,
      getSession,
      setMode,
      updateDraft,
      save,
      discard,
      reload,
      clear
    }),
    [clear, discard, getSession, reload, save, session, setMode, updateDraft]
  )
}
