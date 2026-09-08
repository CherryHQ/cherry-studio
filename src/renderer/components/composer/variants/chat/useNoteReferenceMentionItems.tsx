import { useDirectoryTree } from '@renderer/hooks/useDirectoryTree'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { projectNotesTree, resolveNotesPath } from '@renderer/services/NotesService'
import { flattenTreeToFiles } from '@renderer/services/NotesTreeService'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { Editor } from '@tiptap/core'
import { NotebookPen } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ComposerSuggestionItem } from '../../quickPanel'
import { NOTES_TREE_OPTIONS,noteToComposerAttachment } from '../../tools/definitions/noteReference'
import { fileToComposerToken } from '../shared/composerTokens'

const NOTE_MENTION_RESULT_LIMIT = 50

interface NoteReferenceMentionOptions {
  files: ComposerAttachment[]
  setFiles: React.Dispatch<React.SetStateAction<ComposerAttachment[]>>
}

interface NoteReferenceMentionItems {
  getItems: (options: { query: string; editor: Editor }) => Promise<ComposerSuggestionItem[]>
}

const normalizePath = (value: string) => value.replace(/\\/g, '/')

export function useNoteReferenceMentionItems({
  files,
  setFiles
}: NoteReferenceMentionOptions): NoteReferenceMentionItems {
  const { t } = useTranslation()
  const { notesPath } = useNotesSettings()
  const [resolvedNotesPath, setResolvedNotesPath] = useState<string>()
  const [pathError, setPathError] = useState<Error | null>(null)
  const stateRef = useRef({ files, notesPath, setFiles, t })
  stateRef.current = { files, notesPath, setFiles, t }

  useEffect(() => {
    let cancelled = false
    setResolvedNotesPath(undefined)
    setPathError(null)

    void resolveNotesPath(notesPath)
      .then(({ path }) => {
        if (!cancelled) setResolvedNotesPath(path)
      })
      .catch((error) => {
        if (!cancelled) setPathError(error instanceof Error ? error : new Error(String(error)))
      })

    return () => {
      cancelled = true
    }
  }, [notesPath])

  const { root, isLoading, error, version } = useDirectoryTree(resolvedNotesPath, NOTES_TREE_OPTIONS)
  const noteFiles = useMemo(() => {
    void version
    if (!root || !resolvedNotesPath) return []
    return flattenTreeToFiles(projectNotesTree(root, resolvedNotesPath))
  }, [resolvedNotesPath, root, version])

  const getItems = useCallback(
    async ({ query }: { query: string; editor: Editor }): Promise<ComposerSuggestionItem[]> => {
      const { files, t } = stateRef.current
      if (pathError || error) {
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

      if (isLoading || !resolvedNotesPath) {
        return [
          {
            id: 'note-reference:mention-loading',
            label: t('chat.input.note_reference.loading'),
            icon: <NotebookPen size={16} />,
            disabled: true,
            command: () => undefined
          }
        ]
      }

      const normalizedQuery = query.trim().toLowerCase()

      return noteFiles
        .filter((note) => (normalizedQuery ? `${note.name} ${note.treePath}`.toLowerCase().includes(normalizedQuery) : true))
        .slice(0, NOTE_MENTION_RESULT_LIMIT)
        .map((note): ComposerSuggestionItem => {
          const normalizedPath = normalizePath(note.externalPath)
          const isSelected = files.some((file) => normalizePath(file.path ?? '') === normalizedPath)

          return {
            id: `note-reference:${normalizedPath}`,
            label: note.name,
            description: note.treePath,
            filterText: `${note.name} ${note.treePath}`,
            icon: <NotebookPen size={16} />,
            disabled: isSelected,
            command: ({ editor }) => {
              const currentFiles = stateRef.current.files
              if (currentFiles.some((file) => normalizePath(file.path ?? '') === normalizedPath)) return

              const attachment = noteToComposerAttachment(note)
              editor.chain().focus().insertComposerToken(fileToComposerToken(attachment)).insertContent(' ').run()
              stateRef.current.setFiles((previousFiles) =>
                previousFiles.some((file) => normalizePath(file.path ?? '') === normalizedPath)
                  ? previousFiles
                  : [...previousFiles, attachment]
              )
            }
          }
        })
    },
    [error, isLoading, noteFiles, pathError, resolvedNotesPath]
  )

  return { getItems }
}
