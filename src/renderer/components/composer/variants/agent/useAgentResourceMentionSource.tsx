import { FILE_TYPE } from '@renderer/types/file'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { createComposerFileTokenSourceId } from '@renderer/utils/message/composerFileTokenSource'
import { type AbsoluteFilePath, AbsoluteFilePathSchema, type DirectoryEntry } from '@shared/types/file'
import { getFileTypeByExt } from '@shared/utils/file'
import type { Editor } from '@tiptap/core'
import { File, Folder } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { serializeComposerDocument } from '../../composerDraft'
import { createComposerFolderToken } from '../../folderToken'
import type { ComposerSuggestionItem, ComposerSuggestionSource } from '../../quickPanel'
import { agentComposerTokenId, agentFileToComposerToken } from '../agentComposerTokens'
import { getAccessiblePathRelativePath, getPathComparisonKey } from './accessiblePath'

const normalizePathSeparators = (filePath: string) => filePath.replace(/\\/g, '/')

const getBaseName = (filePath: string) => {
  const normalized = normalizePathSeparators(filePath)
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

const EMPTY_QUERY_RESOURCE_LIMIT = 5
// Matches main's own `listDirectory` default depth; the previous 3 hid every file
// nested deeper than three levels in a real workspace.
const RESOURCE_SEARCH_MAX_DEPTH = 10
const RESOURCE_RESULT_LIMIT = 40
const RESOURCE_SEARCH_DEBOUNCE_MS = 200

type ResourceSearchResult = PromiseSettledResult<DirectoryEntry[]>[] | null

interface PendingResourceSearch {
  resolve: (results: ResourceSearchResult) => void
  timerId: number
}

const createAccessiblePathsKey = (accessiblePaths: readonly string[]) =>
  accessiblePaths.map((item) => item.replace(/\\/g, '/')).join('\0')

const createGroupHeaderItem = (id: string, label: string): ComposerSuggestionItem => ({
  id,
  label,
  disabled: true,
  command: () => undefined
})

interface AgentResourceMentionOptions {
  accessiblePaths: readonly AbsoluteFilePath[]
  files: ComposerAttachment[]
  setFiles: React.Dispatch<React.SetStateAction<ComposerAttachment[]>>
  /** Whether the agent session exposes any accessible workspace paths to mention. */
  enabled: boolean
  /** Extra items appended after the workspace resources, sharing the same `@` panel. */
  getAdditionalItems?: (options: { query: string; editor: Editor }) => Promise<ComposerSuggestionItem[]>
}

/**
 * Provides the agent composer's `@`-mention suggestion source, which lists workspace files and
 * folders. Files become managed file tokens; folders become path-only folder tokens. An empty
 * query reads one bounded root page, while a real query delegates bounded fuzzy search to main.
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
  const pendingResourceSearchRef = useRef<PendingResourceSearch | undefined>(undefined)
  const resourceSearchGenerationRef = useRef(0)
  const accessiblePathsKey = createAccessiblePathsKey(accessiblePaths)
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

  const invalidateResourceSearch = useCallback(() => {
    resourceSearchGenerationRef.current += 1
    const pending = pendingResourceSearchRef.current
    if (!pending) return resourceSearchGenerationRef.current
    window.clearTimeout(pending.timerId)
    pendingResourceSearchRef.current = undefined
    pending.resolve(null)
    return resourceSearchGenerationRef.current
  }, [])

  const queryWorkspaceResources = useCallback(
    (searchPaths: readonly string[], normalizedQuery: string): Promise<ResourceSearchResult> => {
      const requestGeneration = invalidateResourceSearch()
      const options = normalizedQuery
        ? {
            recursive: true,
            maxDepth: RESOURCE_SEARCH_MAX_DEPTH,
            includeHidden: false,
            includeFiles: true,
            includeDirectories: true,
            maxEntries: RESOURCE_RESULT_LIMIT,
            searchPattern: normalizedQuery
          }
        : {
            recursive: false,
            includeHidden: false,
            includeFiles: true,
            includeDirectories: true,
            maxEntries: RESOURCE_RESULT_LIMIT,
            searchPattern: '.'
          }
      const execute = async (): Promise<ResourceSearchResult> => {
        const results = await Promise.allSettled(
          searchPaths.map((dirPath) => window.api.file.listDirectoryEntries(dirPath, options))
        )
        return requestGeneration === resourceSearchGenerationRef.current ? results : null
      }

      if (!normalizedQuery) return execute()

      return new Promise<ResourceSearchResult>((resolve) => {
        const timerId = window.setTimeout(() => {
          if (pendingResourceSearchRef.current === pendingSearch) pendingResourceSearchRef.current = undefined
          void execute().then(resolve)
        }, RESOURCE_SEARCH_DEBOUNCE_MS)
        const pendingSearch = { resolve, timerId }
        pendingResourceSearchRef.current = pendingSearch
      })
    },
    [invalidateResourceSearch]
  )

  useEffect(
    () => () => {
      invalidateResourceSearch()
    },
    [accessiblePathsKey, invalidateResourceSearch]
  )

  const resourceMentionSource = useMemo<ComposerSuggestionSource>(
    () => ({
      pluginKey: 'agent-resource-mention-suggestion',
      char: '@',
      title: t('chat.input.resource_panel.title'),
      allowedPrefixes: [' ', '\n'],
      onExit: () => {
        invalidateResourceSearch()
      },
      items: async ({ query, editor }) => {
        const { accessiblePaths, accessiblePathsKey, files, setFiles, getAdditionalItems, t } =
          resourceMentionStateRef.current
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
          // `.` is main's bounded direct-root listing sentinel; a real query switches to
          // bounded recursive fuzzy search without building a renderer-side directory index.
          const results = await queryWorkspaceResources(accessiblePaths, normalizedQuery)
          if (results === null || accessiblePathsKey !== resourceMentionStateRef.current.accessiblePathsKey) return []

          const collectedResources = new Map<AbsoluteFilePath, DirectoryEntry>()
          for (const result of results) {
            if (result.status !== 'fulfilled') continue
            for (const entry of result.value) {
              // `entry.path` is already an `AbsoluteFilePath`; separator normalization drops
              // the brand, so parse it again while preserving main/root order and first-wins dedupe.
              const entryPath = AbsoluteFilePathSchema.parse(normalizePathSeparators(entry.path))
              if (!collectedResources.has(entryPath)) collectedResources.set(entryPath, { ...entry, path: entryPath })
            }
          }

          const allRootsFailed = results.length > 0 && results.every((result) => result.status === 'rejected')
          if (collectedResources.size === 0 && allRootsFailed) {
            resourceItems.push({
              id: 'agent-resource:error',
              label: t('common.error'),
              description: t('chat.input.resource_panel.load_failed'),
              icon: <Folder size={16} />,
              disabled: true,
              command: () => undefined
            })
          } else {
            const mentionedFolderPathKeys = new Set(
              serializeComposerDocument(editor).tokens.flatMap((token) =>
                token.kind === 'folder' && token.promptText ? [getPathComparisonKey(token.promptText)] : []
              )
            )

            for (const [entryPath, entry] of collectedResources) {
              const relativePath = getAccessiblePathRelativePath(entryPath, accessiblePaths)
              if (entry.isDirectory) {
                const entryPathKey = getPathComparisonKey(entryPath)
                resourceItems.push({
                  id: createAgentResourceItemId(entryPath),
                  label: relativePath,
                  description: entryPath,
                  icon: <Folder size={16} />,
                  filterText: `${relativePath} ${entryPath}`,
                  disabled: mentionedFolderPathKeys.has(entryPathKey),
                  command: ({ editor }) => {
                    const exists = serializeComposerDocument(editor).tokens.some(
                      (currentToken) =>
                        currentToken.kind === 'folder' &&
                        getPathComparisonKey(currentToken.promptText ?? '') === entryPathKey
                    )
                    if (!exists) {
                      editor
                        .chain()
                        .focus()
                        .insertComposerToken(createComposerFolderToken(entryPath))
                        .insertContent(' ')
                        .run()
                    }
                  }
                })
                continue
              }

              const filePath = entryPath
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
              label: t('chat.input.resource_panel.no_resources_found.label'),
              description: t('chat.input.resource_panel.no_resources_found.description'),
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
              createGroupHeaderItem(
                'agent-resource:resources-header',
                t('chat.input.resource_panel.categories.resources')
              ),
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
    [invalidateResourceSearch, queryWorkspaceResources, t]
  )

  return useMemo(
    () => (enabled || getAdditionalItems ? [resourceMentionSource] : []),
    [enabled, getAdditionalItems, resourceMentionSource]
  )
}
