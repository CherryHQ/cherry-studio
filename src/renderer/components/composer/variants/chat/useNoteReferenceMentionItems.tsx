import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { resolveNotesPath } from '@renderer/services/NotesService'
import { FILE_TYPE } from '@renderer/types/file'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { createComposerFileTokenSourceId } from '@renderer/utils/message/composerFileTokenSource'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import type { Editor } from '@tiptap/core'
import { NotebookPen } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { ComposerSuggestionItem } from '../../quickPanel'
import { fileToComposerToken } from '../shared/composerTokens'

const NOTE_MENTION_RESULT_LIMIT = 50

interface NoteReferenceMentionOptions {
  files: ComposerAttachment[]
  setFiles: React.Dispatch<React.SetStateAction<ComposerAttachment[]>>
}

interface NoteReferenceMentionItems {
  getItems: (options: { query: string; editor: Editor }) => Promise<ComposerSuggestionItem[]>
  resetItems: () => void
}

const normalizePath = (value: string) => value.replace(/\\/g, '/')
const stripMarkdownExtension = (value: string) => value.replace(/\.md$/i, '')

const createNoteAttachment = (filePath: string): ComposerAttachment => {
  const normalizedPath = normalizePath(filePath)
  const fileName = normalizedPath.split('/').at(-1) || 'note.md'

  return {
    fileTokenSourceId: createComposerFileTokenSourceId(),
    path: AbsoluteFilePathSchema.parse(normalizedPath),
    name: fileName,
    origin_name: fileName,
    ext: '.md',
    size: 0,
    type: FILE_TYPE.TEXT
  }
}

export function useNoteReferenceMentionItems({
  files,
  setFiles
}: NoteReferenceMentionOptions): NoteReferenceMentionItems {
  const { t } = useTranslation()
  const { notesPath } = useNotesSettings()
  const stateRef = useRef({ files, notesPath, setFiles, t })
  const notePathsPromiseRef = useRef<
    { configuredPath: string; promise: Promise<{ rootPath: string; paths: string[] }> } | undefined
  >(undefined)
  stateRef.current = { files, notesPath, setFiles, t }

  const resetItems = useCallback(() => {
    notePathsPromiseRef.current = undefined
  }, [])

  useEffect(() => resetItems, [resetItems])

  const getItems = useCallback(
    async ({ query }: { query: string; editor: Editor }): Promise<ComposerSuggestionItem[]> => {
      const { files, notesPath, t } = stateRef.current
      let pendingNotes = notePathsPromiseRef.current

      if (!pendingNotes || pendingNotes.configuredPath !== notesPath) {
        pendingNotes = {
          configuredPath: notesPath,
          promise: resolveNotesPath(notesPath).then(async ({ path: rootPath }) => ({
            rootPath,
            paths: await window.api.file.listDirectory(rootPath, {
              recursive: true,
              includeHidden: false,
              includeFiles: true,
              includeDirectories: false,
              searchPattern: '.'
            })
          }))
        }
        notePathsPromiseRef.current = pendingNotes
      }

      try {
        const { rootPath, paths } = await pendingNotes.promise
        const normalizedRootPath = normalizePath(rootPath).replace(/\/$/, '')
        const normalizedQuery = query.trim().toLowerCase()

        return paths
          .filter((path) => path.toLowerCase().endsWith('.md'))
          .map((path) => {
            const normalizedPath = normalizePath(path)
            const relativePath = normalizedPath.startsWith(`${normalizedRootPath}/`)
              ? normalizedPath.slice(normalizedRootPath.length + 1)
              : normalizedPath.split('/').at(-1) || normalizedPath
            const description = `/${stripMarkdownExtension(relativePath)}`
            const label = stripMarkdownExtension(relativePath.split('/').at(-1) || relativePath)
            return { label, description, normalizedPath }
          })
          .filter(({ label, description }) =>
            normalizedQuery ? `${label} ${description}`.toLowerCase().includes(normalizedQuery) : true
          )
          .slice(0, NOTE_MENTION_RESULT_LIMIT)
          .map(({ label, description, normalizedPath }): ComposerSuggestionItem => {
            const isSelected = files.some((file) => normalizePath(file.path ?? '') === normalizedPath)

            return {
              id: `note-reference:${normalizedPath}`,
              label,
              description,
              filterText: `${label} ${description}`,
              icon: <NotebookPen size={16} />,
              disabled: isSelected,
              command: ({ editor }) => {
                const currentFiles = stateRef.current.files
                if (currentFiles.some((file) => normalizePath(file.path ?? '') === normalizedPath)) return

                const attachment = createNoteAttachment(normalizedPath)
                editor.chain().focus().insertComposerToken(fileToComposerToken(attachment)).insertContent(' ').run()
                stateRef.current.setFiles((previousFiles) =>
                  previousFiles.some((file) => normalizePath(file.path ?? '') === normalizedPath)
                    ? previousFiles
                    : [...previousFiles, attachment]
                )
              }
            }
          })
      } catch {
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
    },
    []
  )

  return { getItems, resetItems }
}
