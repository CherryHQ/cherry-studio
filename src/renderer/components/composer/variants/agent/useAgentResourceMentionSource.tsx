import { FILE_TYPE } from '@renderer/types/file'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { createComposerFileTokenSourceId } from '@renderer/utils/message/composerFileTokenSource'
import { getFileTypeByExt } from '@shared/utils/file'
import type { Editor } from '@tiptap/core'
import { Folder } from 'lucide-react'
import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { serializeComposerDocument } from '../../composerDraft'
import type { ComposerSuggestionItem, ComposerSuggestionSource } from '../../quickPanel'
import { agentComposerTokenId, agentFileToComposerToken } from '../agentComposerTokens'
import { getAccessiblePathRelativePath } from './accessiblePath'

const getBaseName = (filePath: string) => {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.split('/').pop() || normalized
}

const getFileExtension = (fileName: string) => {
  const lastDotIndex = fileName.lastIndexOf('.')
  return lastDotIndex > 0 ? fileName.slice(lastDotIndex) : ''
}

const createAttachmentFromPath = (filePath: string): ComposerAttachment => {
  const name = getBaseName(filePath)
  const ext = getFileExtension(name)
  return {
    fileTokenSourceId: createComposerFileTokenSourceId(),
    name,
    origin_name: name,
    path: filePath,
    size: 0,
    ext,
    type: ext ? getFileTypeByExt(ext) : FILE_TYPE.OTHER
  }
}

const createStablePathHash = (value: string) => {
  let hash = 0
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash.toString(36)
}

// Item id is derived from the file path (not the token's fileTokenSourceId, which is regenerated
// per query) so the QuickPanel keeps a stable identity — and selection highlight — across keystrokes.
const createAgentResourceItemId = (filePath: string) =>
  `agent-resource:${createStablePathHash(filePath.replace(/\\/g, '/'))}`

const EMPTY_QUERY_FILE_LIMIT = 5

const createGroupHeaderItem = (id: string, label: string): ComposerSuggestionItem => ({
  id,
  label,
  disabled: true,
  command: () => undefined
})

interface AgentResourceMentionOptions {
  accessiblePaths: readonly string[]
  files: ComposerAttachment[]
  setFiles: React.Dispatch<React.SetStateAction<ComposerAttachment[]>>
  /** Whether the agent session exposes any accessible workspace paths to mention. */
  enabled: boolean
  /** Extra items appended after the file results, sharing the same `@` panel. */
  getAdditionalItems?: (options: { query: string; editor: Editor }) => Promise<ComposerSuggestionItem[]>
}

/**
 * Provides the agent composer's `@`-mention suggestion source, which lists workspace files
 * and inserts the picked file as a managed file token. An empty query lists the workspace so
 * files appear as soon as `@` is typed. `getAdditionalItems` results are appended after the
 * file results so extra sources (e.g. topic/session references) share the single `@` panel.
 * Returns an empty list when disabled and no additional source is registered.
 */
export function useAgentResourceMentionSource({
  accessiblePaths,
  files,
  setFiles,
  enabled,
  getAdditionalItems
}: AgentResourceMentionOptions): ComposerSuggestionSource[] {
  const { t } = useTranslation()
  const resourceMentionStateRef = useRef({ accessiblePaths, files, setFiles, getAdditionalItems, t })
  resourceMentionStateRef.current = { accessiblePaths, files, setFiles, getAdditionalItems, t }

  const resourceMentionSource = useMemo<ComposerSuggestionSource>(
    () => ({
      pluginKey: 'agent-resource-mention-suggestion',
      char: '@',
      title: t('chat.input.resource_panel.title'),
      allowedPrefixes: [' ', '\n'],
      items: async ({ query, editor }) => {
        const { accessiblePaths, files, setFiles, getAdditionalItems, t } = resourceMentionStateRef.current
        // Settled here, not at the await below: a rejection there would reject the whole source
        // and the suggestion wrapper would replace the loaded file results with a single error row.
        const additionalItemsPromise = getAdditionalItems?.({ query, editor }).catch((): ComposerSuggestionItem[] => [
          {
            id: 'agent-resource:sessions-error',
            label: t('common.error'),
            description: t('chat.input.reference_panel.load_failed'),
            disabled: true,
            command: () => undefined
          }
        ])

        const fileItems: ComposerSuggestionItem[] = []
        if (accessiblePaths.length > 0) {
          // `.` is the list-all sentinel for the file tree search; a real query switches to search mode.
          const searchPattern = query.trim() || '.'
          const results = await Promise.allSettled(
            accessiblePaths.map((dirPath) =>
              window.api.file.listDirectoryEntries(dirPath, {
                recursive: true,
                maxDepth: 3,
                includeHidden: false,
                includeFiles: true,
                includeDirectories: false,
                maxEntries: 20,
                searchPattern
              })
            )
          )
          const collected = new Set<string>()
          for (const result of results) {
            if (result.status !== 'fulfilled') continue
            for (const entry of result.value) {
              if (!entry.isDirectory) {
                collected.add(entry.path.replace(/\\/g, '/'))
              }
            }
          }

          if (collected.size === 0 && results.some((result) => result.status === 'rejected')) {
            fileItems.push({
              id: 'agent-resource:error',
              label: t('common.error'),
              description: t('chat.input.resource_panel.no_file_found.description'),
              icon: <Folder size={16} />,
              disabled: true,
              command: () => undefined
            })
          } else {
            for (const filePath of [...collected].slice(0, 50)) {
              const relativePath = getAccessiblePathRelativePath(filePath, accessiblePaths)
              const file = files.find((currentFile) => currentFile.path === filePath)
              const tokenFile = file ?? createAttachmentFromPath(filePath)
              const token = agentFileToComposerToken(tokenFile)
              const isSelectedFile = (currentFile: ComposerAttachment) =>
                currentFile.path === filePath || agentComposerTokenId.file(currentFile) === token.id

              fileItems.push({
                id: createAgentResourceItemId(filePath),
                label: relativePath,
                description: filePath,
                icon: <Folder size={16} />,
                filterText: `${relativePath} ${filePath}`,
                disabled: files.some(isSelectedFile),
                command: ({ editor }) => {
                  const exists = serializeComposerDocument(editor).tokens.some(
                    (currentToken) => currentToken.id === token.id
                  )
                  if (!exists) {
                    editor.chain().focus().insertComposerToken(token).insertContent(' ').run()
                  }
                  setFiles((prevFiles) => (prevFiles.some(isSelectedFile) ? prevFiles : [...prevFiles, tokenFile]))
                }
              })
            }
          }
        }

        const additionalItems = additionalItemsPromise ? await additionalItemsPromise : []
        if (fileItems.length === 0 && additionalItems.length === 0 && accessiblePaths.length === 0) {
          return [
            {
              id: 'agent-resource:no-paths',
              label: t('chat.input.resource_panel.no_file_found.label'),
              description: t('chat.input.resource_panel.no_file_found.description'),
              icon: <Folder size={16} />,
              disabled: true,
              command: () => undefined
            }
          ]
        }

        // With no query, an uncapped file list buries the appended items below the fold,
        // so group both under header rows and keep only the first few files; typing
        // searches both sides in full.
        if (!query.trim() && additionalItems.length > 0) {
          const grouped: ComposerSuggestionItem[] = []
          if (fileItems.length > 0) {
            grouped.push(
              createGroupHeaderItem('agent-resource:files-header', t('chat.input.resource_panel.categories.files')),
              ...fileItems.slice(0, EMPTY_QUERY_FILE_LIMIT)
            )
          }
          grouped.push(
            createGroupHeaderItem('agent-resource:sessions-header', t('chat.input.reference_panel.session.title')),
            ...additionalItems
          )
          return grouped
        }
        return [...fileItems, ...additionalItems]
      }
    }),
    [t]
  )

  return useMemo(
    () => (enabled || getAdditionalItems ? [resourceMentionSource] : []),
    [enabled, getAdditionalItems, resourceMentionSource]
  )
}
