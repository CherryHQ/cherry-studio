import { useDirectoryTree } from '@renderer/hooks/useDirectoryTree'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { projectNotesTree, resolveNotesPath } from '@renderer/services/NotesService'
import { flattenTreeToFiles } from '@renderer/services/NotesTreeService'
import type { NotesTreeNode } from '@renderer/types/note'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { Editor } from '@tiptap/core'
import type { TFunction } from 'i18next'
import { NotebookPen } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ComposerSuggestionItem } from '../../quickPanel'
import { NOTES_TREE_OPTIONS, noteToComposerAttachment } from '../../tools/definitions/noteReference'
import { fileToComposerToken } from '../shared/composerTokens'

const NOTE_MENTION_RESULT_LIMIT = 50

interface NoteReferenceMentionOptions {
  files: ComposerAttachment[]
  setFiles: React.Dispatch<React.SetStateAction<ComposerAttachment[]>>
}

interface NoteReferenceMentionItems {
  getItems: (options: { query: string; editor: Editor }) => Promise<ComposerSuggestionItem[]>
}

interface NotesPathResolution {
  requestPath: string
  path?: string
  error?: Error
}

interface PendingNotesLoad {
  requestPath: string
  promise: Promise<void>
  resolve: () => void
}

interface LatestMentionState {
  files: ComposerAttachment[]
  isLoadTerminal: boolean
  noteFiles: NotesTreeNode[]
  notesPath: string
  pathError: Error | null
  requestedNotesPath: string | null
  setFiles: React.Dispatch<React.SetStateAction<ComposerAttachment[]>>
  t: TFunction
  treeError: Error | null
}

const normalizePath = (value: string) => value.replace(/\\/g, '/')

function createPendingNotesLoad(requestPath: string): PendingNotesLoad {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })

  return { requestPath, promise, resolve }
}

function loadFailedItem(t: TFunction): ComposerSuggestionItem[] {
  return [
    {
      id: 'note-reference:mention-error',
      label: t('chat.input.note_reference.load_failed'),
      icon: <NotebookPen size={16} />,
      disabled: true,
      command: () => undefined
    }
  ]
}

export function useNoteReferenceMentionItems({
  files,
  setFiles
}: NoteReferenceMentionOptions): NoteReferenceMentionItems {
  const { t } = useTranslation()
  const { notesPath } = useNotesSettings()
  const configuredNotesPath = notesPath || ''
  const [requestedNotesPath, setRequestedNotesPath] = useState<string | null>(null)
  const [resolution, setResolution] = useState<NotesPathResolution | null>(null)
  const pendingLoadRef = useRef<PendingNotesLoad | null>(null)
  const mountedRef = useRef(true)
  const stateRef = useRef<LatestMentionState | null>(null)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      pendingLoadRef.current?.resolve()
      pendingLoadRef.current = null
    }
  }, [])

  useEffect(() => {
    if (requestedNotesPath === null) return

    let cancelled = false
    setResolution(null)

    void resolveNotesPath(requestedNotesPath)
      .then((resolved) => {
        if (!cancelled) setResolution({ requestPath: requestedNotesPath, path: resolved.path })
      })
      .catch((error) => {
        if (!cancelled) {
          setResolution({
            requestPath: requestedNotesPath,
            error: error instanceof Error ? error : new Error(String(error))
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [requestedNotesPath])

  const resolvedNotesPath =
    resolution?.requestPath === requestedNotesPath && !resolution.error ? resolution.path : undefined
  const pathError = resolution?.requestPath === requestedNotesPath ? (resolution.error ?? null) : null
  const { root, isLoading, error, version } = useDirectoryTree(resolvedNotesPath, NOTES_TREE_OPTIONS)
  const treeMatchesResolvedPath = Boolean(
    root && resolvedNotesPath && normalizePath(root.path) === normalizePath(resolvedNotesPath)
  )
  const treeError = resolvedNotesPath ? error : null
  const isLoadTerminal = Boolean(pathError || treeError || (resolvedNotesPath && treeMatchesResolvedPath && !isLoading))
  const noteFiles = useMemo(() => {
    void version
    if (!root || !resolvedNotesPath || !treeMatchesResolvedPath) return []
    return flattenTreeToFiles(projectNotesTree(root, resolvedNotesPath))
  }, [resolvedNotesPath, root, treeMatchesResolvedPath, version])

  stateRef.current = {
    files,
    isLoadTerminal,
    noteFiles,
    notesPath: configuredNotesPath,
    pathError,
    requestedNotesPath,
    setFiles,
    t,
    treeError
  }

  useEffect(() => {
    const pending = pendingLoadRef.current
    if (!pending || pending.requestPath !== requestedNotesPath || !isLoadTerminal) return

    pending.resolve()
    pendingLoadRef.current = null
  }, [isLoadTerminal, requestedNotesPath])

  const waitForCurrentNotes = useCallback(async (): Promise<LatestMentionState | null> => {
    while (mountedRef.current) {
      const current = stateRef.current
      if (!current) return null

      const requestPath = current.notesPath
      if (current.requestedNotesPath === requestPath && current.isLoadTerminal) return current

      let pending = pendingLoadRef.current
      if (!pending || pending.requestPath !== requestPath) {
        pending?.resolve()
        pending = createPendingNotesLoad(requestPath)
        pendingLoadRef.current = pending
        setRequestedNotesPath(requestPath)
      }

      await pending.promise
    }

    return null
  }, [])

  const getItems = useCallback(
    async ({ query }: { query: string; editor: Editor }): Promise<ComposerSuggestionItem[]> => {
      const current = await waitForCurrentNotes()
      if (!current || current.pathError || current.treeError) return loadFailedItem(current?.t ?? t)

      const normalizedQuery = query.trim().toLowerCase()

      return current.noteFiles
        .filter((note) =>
          normalizedQuery ? `${note.name} ${note.treePath}`.toLowerCase().includes(normalizedQuery) : true
        )
        .slice(0, NOTE_MENTION_RESULT_LIMIT)
        .map((note): ComposerSuggestionItem => {
          const normalizedPath = normalizePath(note.externalPath)
          const isSelected = current.files.some((file) => normalizePath(file.path ?? '') === normalizedPath)

          return {
            id: `note-reference:${normalizedPath}`,
            label: note.name,
            description: note.treePath,
            filterText: `${note.name} ${note.treePath}`,
            icon: <NotebookPen size={16} />,
            disabled: isSelected,
            command: ({ editor }) => {
              const currentFiles = stateRef.current?.files ?? []
              if (currentFiles.some((file) => normalizePath(file.path ?? '') === normalizedPath)) return

              const attachment = noteToComposerAttachment(note)
              editor.chain().focus().insertComposerToken(fileToComposerToken(attachment)).insertContent(' ').run()
              stateRef.current?.setFiles((previousFiles) =>
                previousFiles.some((file) => normalizePath(file.path ?? '') === normalizedPath)
                  ? previousFiles
                  : [...previousFiles, attachment]
              )
            }
          }
        })
    },
    [t, waitForCurrentNotes]
  )

  return { getItems }
}
