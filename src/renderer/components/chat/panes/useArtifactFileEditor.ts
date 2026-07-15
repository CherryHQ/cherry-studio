import { ipcApi } from '@renderer/ipc'
import type { FilePath } from '@shared/types/file'
import { canonicalizeAbsolutePath, createFilePathHandle } from '@shared/utils/file'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ArtifactPaneFileSelection } from './artifactPanePath'

export type ArtifactFileEditorMode = 'preview' | 'edit'

export interface ArtifactFileEditSession {
  mode: ArtifactFileEditorMode
  status: 'loading' | 'ready' | 'saving'
  draft: string
  savedContent: string
  version?: { mtime: number; size: number }
  contentHash?: string
  lineEnding?: 'lf' | 'crlf'
  hasBom?: boolean
}

export interface ArtifactFileEditor {
  sessions: Readonly<Record<string, ArtifactFileEditSession>>
  getSession: (selection: ArtifactPaneFileSelection) => ArtifactFileEditSession | undefined
  setMode: (selection: ArtifactPaneFileSelection, mode: ArtifactFileEditorMode) => Promise<void>
  updateDraft: (selection: ArtifactPaneFileSelection, draft: string) => void
  save: (selection: ArtifactPaneFileSelection) => Promise<void>
  discard: (selection: ArtifactPaneFileSelection) => void
  reload: (selection: ArtifactPaneFileSelection) => Promise<void>
}

function getSelectionPath(selection: ArtifactPaneFileSelection): FilePath {
  return canonicalizeAbsolutePath(`${selection.workspacePath}/${selection.filePath}`) as FilePath
}

export function getArtifactFileEditKey(selection: ArtifactPaneFileSelection): string {
  return getSelectionPath(selection)
}

function isDirty(session: ArtifactFileEditSession): boolean {
  return session.draft !== session.savedContent
}

/**
 * File-specific controller for the generic PreviewEditor. Callers may lift this
 * hook above view swaps so drafts survive remounts.
 */
export function useArtifactFileEditor(resetKey?: string): ArtifactFileEditor {
  const [sessions, setSessions] = useState<Record<string, ArtifactFileEditSession>>({})
  const requestVersionsRef = useRef(new Map<string, number>())
  const previousResetKeyRef = useRef(resetKey)

  useEffect(() => {
    if (previousResetKeyRef.current === resetKey) return
    previousResetKeyRef.current = resetKey
    requestVersionsRef.current.clear()
    setSessions({})
  }, [resetKey])

  const getSession = useCallback(
    (selection: ArtifactPaneFileSelection) => sessions[getArtifactFileEditKey(selection)],
    [sessions]
  )

  const load = useCallback(async (selection: ArtifactPaneFileSelection, requestedMode?: ArtifactFileEditorMode) => {
    const key = getArtifactFileEditKey(selection)
    const requestVersion = (requestVersionsRef.current.get(key) ?? 0) + 1
    requestVersionsRef.current.set(key, requestVersion)

    setSessions((current) => {
      const existing = current[key]
      const retained = Object.fromEntries(
        Object.entries(current).filter(([sessionKey, session]) => sessionKey === key || isDirty(session))
      )
      retained[key] = {
        mode: requestedMode ?? existing?.mode ?? 'preview',
        status: 'loading',
        draft: existing?.draft ?? '',
        savedContent: existing?.savedContent ?? '',
        version: existing?.version,
        contentHash: existing?.contentHash,
        lineEnding: existing?.lineEnding,
        hasBom: existing?.hasBom
      }
      return retained
    })

    try {
      const snapshot = await ipcApi.request('file.read_text_snapshot', createFilePathHandle(key as FilePath))
      if (requestVersionsRef.current.get(key) !== requestVersion) return
      setSessions((current) => {
        const existing = current[key]
        return {
          ...current,
          [key]: {
            mode: requestedMode ?? existing?.mode ?? 'preview',
            status: 'ready',
            draft: snapshot.content,
            savedContent: snapshot.content,
            version: snapshot.version,
            contentHash: snapshot.contentHash,
            lineEnding: snapshot.lineEnding,
            hasBom: snapshot.hasBom
          }
        }
      })
    } catch (error) {
      if (requestVersionsRef.current.get(key) === requestVersion) {
        setSessions((current) => {
          const failed = current[key]
          if (failed?.version) {
            return { ...current, [key]: { ...failed, status: 'ready' } }
          }
          const next = { ...current }
          delete next[key]
          return next
        })
      }
      throw error
    }
  }, [])

  const setMode = useCallback(
    async (selection: ArtifactPaneFileSelection, mode: ArtifactFileEditorMode) => {
      const key = getArtifactFileEditKey(selection)
      const session = sessions[key]
      if (mode === 'edit' && !session) {
        await load(selection, 'edit')
        return
      }
      setSessions((current) => {
        const existing = current[key]
        return existing ? { ...current, [key]: { ...existing, mode } } : current
      })
    },
    [load, sessions]
  )

  const updateDraft = useCallback((selection: ArtifactPaneFileSelection, draft: string) => {
    const key = getArtifactFileEditKey(selection)
    setSessions((current) => {
      const existing = current[key]
      return existing ? { ...current, [key]: { ...existing, draft } } : current
    })
  }, [])

  const save = useCallback(
    async (selection: ArtifactPaneFileSelection) => {
      const key = getArtifactFileEditKey(selection)
      const session = sessions[key]
      if (
        !session ||
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
      setSessions((current) => {
        const existing = current[key]
        return existing ? { ...current, [key]: { ...existing, status: 'saving' } } : current
      })

      try {
        const result = await ipcApi.request('file.write_text_if_unchanged', {
          handle: createFilePathHandle(key as FilePath),
          content: submittedDraft,
          lineEnding: session.lineEnding,
          hasBom: session.hasBom,
          expectedVersion: session.version,
          expectedContentHash: session.contentHash
        })
        setSessions((current) => {
          const existing = current[key]
          if (!existing) return current
          return {
            ...current,
            [key]: {
              ...existing,
              status: 'ready',
              savedContent: submittedDraft,
              version: result.version,
              contentHash: result.contentHash
            }
          }
        })
      } catch (error) {
        setSessions((current) => {
          const existing = current[key]
          return existing ? { ...current, [key]: { ...existing, status: 'ready' } } : current
        })
        throw error
      }
    },
    [sessions]
  )

  const discard = useCallback((selection: ArtifactPaneFileSelection) => {
    const key = getArtifactFileEditKey(selection)
    setSessions((current) => {
      const existing = current[key]
      return existing ? { ...current, [key]: { ...existing, draft: existing.savedContent } } : current
    })
  }, [])

  const reload = useCallback(
    async (selection: ArtifactPaneFileSelection) => {
      await load(selection)
    },
    [load]
  )

  return useMemo(
    () => ({ sessions, getSession, setMode, updateDraft, save, discard, reload }),
    [discard, getSession, reload, save, sessions, setMode, updateDraft]
  )
}
