import { FILE_TYPE } from '@renderer/types/file'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { createComposerFileTokenSourceId } from '@renderer/utils/message/composerFileTokenSource'
import { getFileTypeByExt } from '@shared/utils/file'
import { Folder } from 'lucide-react'
import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { ComposerUnifiedPanelResourceProvider } from '../../quickPanel'
import { agentComposerTokenId, agentFileToComposerToken } from '../agentComposerTokens'

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

const createAgentResourceItemId = (filePath: string) =>
  `agent-resource:${createStablePathHash(filePath.replace(/\\/g, '/'))}`

const getRelativePath = (filePath: string, accessiblePaths: readonly string[]) => {
  const normalizedFilePath = filePath.replace(/\\/g, '/')

  for (const basePath of accessiblePaths) {
    const normalizedBasePath = basePath.replace(/\\/g, '/')
    const baseWithSlash = normalizedBasePath.endsWith('/') ? normalizedBasePath : `${normalizedBasePath}/`

    if (normalizedFilePath.startsWith(baseWithSlash)) {
      return normalizedFilePath.slice(baseWithSlash.length)
    }
  }

  return filePath
}

interface AgentResourceSuggestionOptions {
  accessiblePaths: string[]
  files: ComposerAttachment[]
  setFiles: React.Dispatch<React.SetStateAction<ComposerAttachment[]>>
  /** Whether the agent session exposes any accessible workspace paths to mention. */
  enabled: boolean
}

/**
 * Provides lazy workspace file results for the unified composer panel.
 * Empty queries intentionally return no items so files are not exposed by default.
 */
export function useAgentResourceSearchProvider({
  accessiblePaths,
  files,
  setFiles,
  enabled
}: AgentResourceSuggestionOptions): ComposerUnifiedPanelResourceProvider | undefined {
  const { t } = useTranslation()
  const resourceSuggestionStateRef = useRef({ accessiblePaths, files, setFiles, t })
  resourceSuggestionStateRef.current = { accessiblePaths, files, setFiles, t }

  const resourceProvider = useMemo<ComposerUnifiedPanelResourceProvider>(
    () =>
      async (query, { inputAdapter }) => {
        const { files, setFiles, t } = resourceSuggestionStateRef.current
        const searchPattern = query.trim()
        if (!enabled || searchPattern.length === 0) return []

        if (accessiblePaths.length === 0) {
          return [
            {
              id: 'agent-resource:no-paths',
              label: t('chat.input.resource_panel.no_file_found.label'),
              description: t('chat.input.resource_panel.no_file_found.description'),
              icon: <Folder size={16} />,
              disabled: true,
              action: () => undefined
            }
          ]
        }

        const results = await Promise.allSettled(
          accessiblePaths.map((dirPath) =>
            window.api.file.listDirectory(dirPath, {
              recursive: true,
              maxDepth: 3,
              includeHidden: false,
              includeFiles: true,
              includeDirectories: true,
              maxEntries: 20,
              searchPattern
            })
          )
        )
        const collected = new Set<string>()
        for (const result of results) {
          if (result.status !== 'fulfilled') continue
          for (const filePath of result.value) {
            collected.add(filePath.replace(/\\/g, '/'))
          }
        }

        if (collected.size === 0 && results.some((result) => result.status === 'rejected')) {
          return [
            {
              id: 'agent-resource:error',
              label: t('common.error'),
              description: t('chat.input.resource_panel.no_file_found.description'),
              icon: <Folder size={16} />,
              disabled: true,
              action: () => undefined
            }
          ]
        }

        return [...collected].slice(0, 50).map((filePath) => {
          const relativePath = getRelativePath(filePath, accessiblePaths)
          const file = files.find((currentFile) => currentFile.path === filePath)
          const tokenFile = file ?? createAttachmentFromPath(filePath)
          const token = agentFileToComposerToken(tokenFile)
          const isSelectedFile = (currentFile: ComposerAttachment) =>
            currentFile.path === filePath || agentComposerTokenId.file(currentFile) === token.id

          return {
            id: createAgentResourceItemId(filePath),
            label: relativePath,
            description: filePath,
            icon: <Folder size={16} />,
            filterText: `${relativePath} ${filePath}`,
            disabled: files.some(isSelectedFile),
            action: ({ inputAdapter: actionInputAdapter }) => {
              const targetInputAdapter = actionInputAdapter ?? inputAdapter
              if (!files.some(isSelectedFile)) {
                targetInputAdapter?.insertToken?.(token)
              }
              targetInputAdapter?.focus()
              setFiles((prevFiles) => (prevFiles.some(isSelectedFile) ? prevFiles : [...prevFiles, tokenFile]))
            }
          }
        })
      },
    [accessiblePaths, enabled]
  )

  return useMemo(() => (enabled ? resourceProvider : undefined), [enabled, resourceProvider])
}
