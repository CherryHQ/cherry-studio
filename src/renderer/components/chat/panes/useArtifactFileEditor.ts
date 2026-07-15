import { ipcApi } from '@renderer/ipc'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { OutputFor } from '@shared/ipc/types'
import type { FilePath } from '@shared/types/file'
import { canonicalizeAbsolutePath, createFilePathHandle } from '@shared/utils/file'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ArtifactPaneFileSelection } from './artifactPanePath'

export type ArtifactFileEditorMode = 'preview' | 'edit'

type TextEditSnapshot = OutputFor<'file.read_text_snapshot'>

export interface ArtifactFileEditSession {
  filePath: FilePath
  mode: ArtifactFileEditorMode
  status: 'loading' | 'ready' | 'saving' | 'conflict'
  draft: string
  savedContent: string
  version?: TextEditSnapshot['version']
  contentHash?: string
  lineEnding?: TextEditSnapshot['lineEnding']
  hasBom?: boolean
}

export interface ArtifactFileEditor {
  session: ArtifactFileEditSession | undefined
  hasUnsavedChanges: boolean
  getSession: (selection: ArtifactPaneFileSelection) => ArtifactFileEditSession | undefined
  setMode: (selection: ArtifactPaneFileSelection, mode: ArtifactFileEditorMode) => Promise<void>
  updateDraft: (selection: ArtifactPaneFileSelection, draft: string) => void
  save: (selection: ArtifactPaneFileSelection) => Promise<void>
  discard: (selection: ArtifactPaneFileSelection) => void
  reload: (selection: ArtifactPaneFileSelection) => Promise<void>
  clear: () => void
}

function getSelectionPath(selection: ArtifactPaneFileSelection): FilePath {
  return canonicalizeAbsolutePath(`${selection.workspacePath}/${selection.filePath}`) as FilePath
}

function isDirty(session: ArtifactFileEditSession): boolean {
  return session.draft !== session.savedContent
}

/**
 * Controller for the one file currently being edited. Callers may lift this
 * hook above layout remounts, but must clear it when the file is closed or changed.
 */
export function useArtifactFileEditor(resetKey?: string): ArtifactFileEditor {
  const [session, setSession] = useState<ArtifactFileEditSession>()
  const requestVersionRef = useRef(0)
  const previousResetKeyRef = useRef(resetKey)

  const clear = useCallback(() => {
    requestVersionRef.current += 1
    setSession(undefined)
  }, [])

  useEffect(() => {
    if (previousResetKeyRef.current === resetKey) return
    previousResetKeyRef.current = resetKey
    clear()
  }, [clear, resetKey])

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
        savedContent: previousSession?.savedContent ?? '',
        version: previousSession?.version,
        contentHash: previousSession?.contentHash,
        lineEnding: previousSession?.lineEnding,
        hasBom: previousSession?.hasBom
      })

      try {
        const snapshot = await ipcApi.request('file.read_text_snapshot', createFilePathHandle(filePath))
        if (requestVersionRef.current !== requestVersion) return

        setSession((current) => {
          if (current?.filePath !== filePath) return current
          return {
            filePath,
            mode: requestedMode ?? current.mode,
            status: 'ready',
            draft: snapshot.content,
            savedContent: snapshot.content,
            version: snapshot.version,
            contentHash: snapshot.contentHash,
            lineEnding: snapshot.lineEnding,
            hasBom: snapshot.hasBom
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
      if (
        session?.filePath !== filePath ||
        session.status !== 'ready' ||
        !session.version ||
        !session.contentHash ||
        !session.lineEnding ||
        session.hasBom === undefined ||
        !isDirty(session)
      ) {
        return
      }

      const submittedDraft = session.draft
      const requestVersion = requestVersionRef.current + 1
      requestVersionRef.current = requestVersion
      setSession((current) => (current?.filePath === filePath ? { ...current, status: 'saving' as const } : current))

      try {
        const result = await ipcApi.request('file.write_text_if_unchanged', {
          handle: createFilePathHandle(filePath),
          content: submittedDraft,
          lineEnding: session.lineEnding,
          hasBom: session.hasBom,
          expectedVersion: session.version,
          expectedContentHash: session.contentHash
        })
        if (requestVersionRef.current !== requestVersion) return

        setSession((current) => {
          if (current?.filePath !== filePath) return current
          return {
            ...current,
            status: 'ready',
            savedContent: submittedDraft,
            version: result.version,
            contentHash: result.contentHash
          }
        })
      } catch (error) {
        if (requestVersionRef.current === requestVersion) {
          setSession((current) => {
            if (current?.filePath !== filePath) return current
            const status =
              error instanceof IpcError && error.code === fileErrorCodes.TEXT_EDIT_STALE ? 'conflict' : 'ready'
            return { ...current, status }
          })
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
      session,
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
