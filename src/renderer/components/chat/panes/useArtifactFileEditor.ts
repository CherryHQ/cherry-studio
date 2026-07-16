import { ipcApi } from '@renderer/ipc'
import type { FilePath, FileVersion } from '@shared/types/file'
import { canonicalizeAbsolutePath, createFilePathHandle } from '@shared/utils/file'
import { useCallback, useMemo, useRef, useState } from 'react'

import type { ArtifactPaneFileSelection } from './artifactPanePath'

type ArtifactFileEditorMode = 'preview' | 'edit'
type ArtifactFileLineEnding = 'lf' | 'crlf'
type UnsupportedArtifactFileEditReason = 'encoding' | 'mixed-line-endings'

const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf])

interface ArtifactFileEditSession {
  mode: ArtifactFileEditorMode
  status: 'loading' | 'ready' | 'saving'
  draft: string
  savedContent: string
  lineEnding: ArtifactFileLineEnding
  hasBom: boolean
}

interface StoredArtifactFileEditSession extends ArtifactFileEditSession {
  filePath: string
  version?: FileVersion
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

export class UnsupportedArtifactFileEditError extends Error {
  constructor(public readonly reason: UnsupportedArtifactFileEditReason) {
    super(`Artifact file editing is not supported (${reason})`)
    this.name = 'UnsupportedArtifactFileEditError'
  }
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= UTF8_BOM.length && UTF8_BOM.every((value, index) => bytes[index] === value)
}

function decodeArtifactFile(bytes: Uint8Array): {
  content: string
  lineEnding: ArtifactFileLineEnding
  hasBom: boolean
} {
  const hasBom = hasUtf8Bom(bytes)
  let content: string
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(hasBom ? bytes.slice(UTF8_BOM.length) : bytes)
  } catch {
    throw new UnsupportedArtifactFileEditError('encoding')
  }

  // NUL is a strong binary signal even when its byte sequence is technically valid UTF-8.
  if (content.includes('\0')) throw new UnsupportedArtifactFileEditError('encoding')

  const withoutCrlf = content.replace(/\r\n/g, '')
  const hasCrlf = content.includes('\r\n')
  if (withoutCrlf.includes('\r') || (hasCrlf && withoutCrlf.includes('\n'))) {
    throw new UnsupportedArtifactFileEditError('mixed-line-endings')
  }

  return {
    content: hasCrlf ? content.replace(/\r\n/g, '\n') : content,
    lineEnding: hasCrlf ? 'crlf' : 'lf',
    hasBom
  }
}

function encodeArtifactFile(content: string, lineEnding: ArtifactFileLineEnding, hasBom: boolean): Uint8Array {
  const normalized = content.replace(/\r\n?/g, '\n')
  const encoded = new TextEncoder().encode(lineEnding === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized)
  if (!hasBom) return encoded

  const withBom = new Uint8Array(UTF8_BOM.length + encoded.length)
  withBom.set(UTF8_BOM)
  withBom.set(encoded, UTF8_BOM.length)
  return withBom
}

function getSelectionPath(selection: ArtifactPaneFileSelection): FilePath {
  return canonicalizeAbsolutePath(`${selection.workspacePath}/${selection.filePath}`) as FilePath
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
        savedContent: previousSession?.savedContent ?? '',
        lineEnding: previousSession?.lineEnding ?? 'lf',
        hasBom: previousSession?.hasBom ?? false,
        version: previousSession?.version
      })

      try {
        const { content, version } = await ipcApi.request('file.read', createFilePathHandle(filePath))
        const snapshot = decodeArtifactFile(content)
        if (requestVersionRef.current !== requestVersion) return

        setSession((current) => {
          if (current?.filePath !== filePath) return current
          return {
            filePath,
            mode: requestedMode ?? current.mode,
            status: 'ready',
            draft: snapshot.content,
            savedContent: snapshot.content,
            lineEnding: snapshot.lineEnding,
            hasBom: snapshot.hasBom,
            version
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
        session.version === undefined ||
        !isDirty(session)
      ) {
        return
      }

      const submittedDraft = session.draft
      const requestVersion = requestVersionRef.current + 1
      requestVersionRef.current = requestVersion
      setSession((current) => (current?.filePath === filePath ? { ...current, status: 'saving' as const } : current))

      try {
        const version = await ipcApi.request('file.write_if_unchanged', {
          handle: createFilePathHandle(filePath),
          data: encodeArtifactFile(submittedDraft, session.lineEnding, session.hasBom),
          expectedVersion: session.version
        })
        if (requestVersionRef.current !== requestVersion) return

        setSession((current) => {
          if (current?.filePath !== filePath) return current
          return {
            ...current,
            status: 'ready',
            savedContent: submittedDraft,
            version
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
