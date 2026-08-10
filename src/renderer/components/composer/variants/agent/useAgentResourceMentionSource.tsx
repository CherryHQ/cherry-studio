import { defaultFilterFn, defaultSortFn, type QuickPanelListItem } from '@renderer/components/QuickPanel'
import { FILE_TYPE } from '@renderer/types/file'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { createComposerFileTokenSourceId } from '@renderer/utils/message/composerFileTokenSource'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import { getFileTypeByExt } from '@shared/utils/file'
import type { Editor } from '@tiptap/core'
import { File, Folder } from 'lucide-react'
import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { serializeComposerDocument } from '../../composerDraft'
import { createComposerFolderToken } from '../../folderToken'
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

const createAttachmentFromPath = (filePath: AbsoluteFilePath): ComposerAttachment => {
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

const AGENT_RESOURCE_SEARCH_MAX_DEPTH = 10
const EMPTY_QUERY_RESOURCE_LIMIT = 5
const DIRECTORY_SEARCH_MAX_DEPTH = 3
const DIRECTORY_RESULT_LIMIT = 20

type DirectoryListingMode = 'root' | 'search'

interface DirectoryListingResult {
  paths: AbsoluteFilePath[]
  hadFailure: boolean
}

type DirectorySuggestionItem = ComposerSuggestionItem & QuickPanelListItem

const createAccessiblePathsKey = (accessiblePaths: readonly string[]) =>
  accessiblePaths.map((item) => item.replace(/\\/g, '/')).join('\0')

const createFuzzyRegex = (query: string) => {
  const pattern = query
    .toLowerCase()
    .split('')
    .map((character) => character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(pattern, 'i')
}

const filterDirectoryItems = (items: DirectorySuggestionItem[], query: string): DirectorySuggestionItem[] => {
  if (!query) return items.slice(0, DIRECTORY_RESULT_LIMIT)

  const fuzzyRegex = createFuzzyRegex(query)
  const pinyinCache = new WeakMap<QuickPanelListItem, string>()
  const filtered = items.filter((item) => defaultFilterFn(item, query, fuzzyRegex, pinyinCache))
  return (defaultSortFn(filtered, query) as DirectorySuggestionItem[]).slice(0, DIRECTORY_RESULT_LIMIT)
}

async function listWorkspaceDirectories(
  accessiblePaths: readonly string[],
  mode: DirectoryListingMode
): Promise<DirectoryListingResult> {
  const recursive = mode === 'search'
  const results = await Promise.allSettled(
    accessiblePaths.map((dirPath) =>
      window.api.file.listDirectory(dirPath, {
        recursive,
        ...(recursive ? { maxDepth: DIRECTORY_SEARCH_MAX_DEPTH } : {}),
        includeHidden: false,
        includeFiles: false,
        includeDirectories: true,
        searchPattern: '.'
      })
    )
  )
  const collected = new Set<AbsoluteFilePath>()
  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    for (const directoryPath of result.value) {
      collected.add(AbsoluteFilePathSchema.parse(directoryPath.replace(/\\/g, '/')))
    }
  }
  return {
    paths: [...collected],
    hadFailure: results.some((result) => result.status === 'rejected')
  }
}

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
  /** Extra items appended after the workspace resources, sharing the same `@` panel. */
  getAdditionalItems?: (options: { query: string; editor: Editor }) => Promise<ComposerSuggestionItem[]>
}

/**
 * Provides the agent composer's `@`-mention suggestion source, which lists workspace files and
 * folders. Files become managed file tokens; folders become path-only folder tokens. Directory
 * traversal is lazy and cached for one `@` panel session: an empty query reads one level, while
 * the first real query indexes the configured depth for renderer-side filtering.
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
  const directoryListingCacheRef = useRef(new Map<string, Promise<DirectoryListingResult>>())
  const directoryListingGenerationRef = useRef(0)
  const accessiblePathsKey = createAccessiblePathsKey(accessiblePaths)
  const directoryListingScopeKeyRef = useRef(accessiblePathsKey)
  const resourceMentionStateRef = useRef({
    accessiblePaths,
    accessiblePathsKey,
    files,
    setFiles,
    getAdditionalItems,
    t
  })
  resourceMentionStateRef.current = {
    accessiblePaths,
    accessiblePathsKey,
    files,
    setFiles,
    getAdditionalItems,
    t
  }

  const resourceMentionSource = useMemo<ComposerSuggestionSource>(
    () => ({
      pluginKey: 'agent-resource-mention-suggestion',
      char: '@',
      title: t('chat.input.resource_panel.title'),
      allowedPrefixes: [' ', '\n'],
      onExit: () => {
        directoryListingCacheRef.current.clear()
        directoryListingGenerationRef.current += 1
      },
      items: async ({ query, editor }) => {
        const { accessiblePaths, accessiblePathsKey, files, setFiles, getAdditionalItems, t } =
          resourceMentionStateRef.current
        if (directoryListingScopeKeyRef.current !== accessiblePathsKey) {
          directoryListingScopeKeyRef.current = accessiblePathsKey
          directoryListingCacheRef.current.clear()
          directoryListingGenerationRef.current += 1
        }
        const requestGeneration = directoryListingGenerationRef.current
        const normalizedQuery = query.trim()
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

        const resourceItems: ComposerSuggestionItem[] = []
        if (accessiblePaths.length > 0) {
          // `.` is the list-all sentinel for the file tree search; a real query switches to search mode.
          const searchPattern = normalizedQuery || '.'
          const fileResultsPromise = Promise.allSettled(
            accessiblePaths.map((dirPath) =>
              window.api.file.listDirectoryEntries(dirPath, {
                recursive: true,
                maxDepth: AGENT_RESOURCE_SEARCH_MAX_DEPTH,
                includeHidden: false,
                includeFiles: true,
                includeDirectories: false,
                maxEntries: 20,
                searchPattern
              })
            )
          )
          const directoryMode: DirectoryListingMode = normalizedQuery ? 'search' : 'root'
          const directoryCacheKey = `${accessiblePathsKey}\0${directoryMode}`
          let directoryListingPromise = directoryListingCacheRef.current.get(directoryCacheKey)
          if (!directoryListingPromise) {
            directoryListingPromise = listWorkspaceDirectories(accessiblePaths, directoryMode)
            directoryListingCacheRef.current.set(directoryCacheKey, directoryListingPromise)
          }
          const [fileResults, directoryListing] = await Promise.all([fileResultsPromise, directoryListingPromise])
          if (
            requestGeneration !== directoryListingGenerationRef.current ||
            accessiblePathsKey !== resourceMentionStateRef.current.accessiblePathsKey
          ) {
            return []
          }

          const collectedFiles = new Set<AbsoluteFilePath>()
          for (const result of fileResults) {
            if (result.status !== 'fulfilled') continue
            for (const entry of result.value) {
              if (!entry.isDirectory) {
                // `entry.path` is already an `AbsoluteFilePath`; the separator
                // normalization drops the brand, so re-assert it.
                collectedFiles.add(AbsoluteFilePathSchema.parse(entry.path.replace(/\\/g, '/')))
              }
            }
          }

          const directoryItems = directoryListing.paths.map<DirectorySuggestionItem>((directoryPath) => {
            const relativePath = getAccessiblePathRelativePath(directoryPath, accessiblePaths)
            return {
              id: createAgentResourceItemId(directoryPath),
              label: relativePath,
              description: directoryPath,
              icon: <Folder size={16} />,
              filterText: `${relativePath} ${directoryPath}`,
              disabled: false,
              command: ({ editor }) => {
                const exists = serializeComposerDocument(editor).tokens.some(
                  (currentToken) => currentToken.kind === 'folder' && currentToken.promptText === directoryPath
                )
                if (!exists) {
                  editor
                    .chain()
                    .focus()
                    .insertComposerToken(createComposerFolderToken(directoryPath))
                    .insertContent(' ')
                    .run()
                }
              }
            }
          })
          resourceItems.push(...filterDirectoryItems(directoryItems, normalizedQuery))

          if (
            directoryListing.paths.length === 0 &&
            collectedFiles.size === 0 &&
            (directoryListing.hadFailure || fileResults.some((result) => result.status === 'rejected'))
          ) {
            resourceItems.push({
              id: 'agent-resource:error',
              label: t('common.error'),
              description: t('chat.input.resource_panel.no_file_found.description'),
              icon: <Folder size={16} />,
              disabled: true,
              command: () => undefined
            })
          } else {
            for (const filePath of [...collectedFiles].slice(0, 50)) {
              const relativePath = getAccessiblePathRelativePath(filePath, accessiblePaths)
              const file = files.find((currentFile) => currentFile.path === filePath)
              const tokenFile = file ?? createAttachmentFromPath(filePath)
              const token = agentFileToComposerToken(tokenFile)
              const isSelectedFile = (currentFile: ComposerAttachment) =>
                currentFile.path === filePath || agentComposerTokenId.file(currentFile) === token.id

              resourceItems.push({
                id: createAgentResourceItemId(filePath),
                label: relativePath,
                description: filePath,
                icon: <File size={16} />,
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
        if (resourceItems.length === 0 && additionalItems.length === 0 && accessiblePaths.length === 0) {
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

        // With no query, an uncapped resource list buries the appended items below the fold,
        // so group both under header rows and keep only the first few resources; typing
        // searches both sides in full.
        if (!normalizedQuery && additionalItems.length > 0) {
          const grouped: ComposerSuggestionItem[] = []
          if (resourceItems.length > 0) {
            grouped.push(
              createGroupHeaderItem('agent-resource:files-header', t('chat.input.resource_panel.categories.files')),
              ...resourceItems.slice(0, EMPTY_QUERY_RESOURCE_LIMIT)
            )
          }
          grouped.push(
            createGroupHeaderItem('agent-resource:sessions-header', t('chat.input.reference_panel.session.title')),
            ...additionalItems
          )
          return grouped
        }
        return [...resourceItems, ...additionalItems]
      }
    }),
    [t]
  )

  return useMemo(
    () => (enabled || getAdditionalItems ? [resourceMentionSource] : []),
    [enabled, getAdditionalItems, resourceMentionSource]
  )
}
