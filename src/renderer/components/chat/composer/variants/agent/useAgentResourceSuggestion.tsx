import { FILE_TYPE } from '@renderer/types'
import type { ComposerAttachment } from '@renderer/utils/messageUtils/composerAttachment'
import { createComposerFileTokenSourceId } from '@renderer/utils/messageUtils/composerFileTokenSource'
import { getFileTypeByExt } from '@shared/utils/file/fileType'
import { Folder } from 'lucide-react'
import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { serializeComposerDocument } from '../../composerDraft'
import type { ComposerSuggestionSource } from '../../quickPanel'
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
 * Provides the agent composer's `@`-mention suggestion source, which lists workspace files
 * and inserts the picked file as a managed file token. Returns an empty list when disabled.
 */
export function useAgentResourceSuggestion({
  accessiblePaths,
  files,
  setFiles,
  enabled
}: AgentResourceSuggestionOptions): ComposerSuggestionSource[] {
  const { t } = useTranslation()
  const resourceSuggestionStateRef = useRef({ accessiblePaths, files, setFiles, t })
  resourceSuggestionStateRef.current = { accessiblePaths, files, setFiles, t }

  const resourceSuggestionSource = useMemo<ComposerSuggestionSource>(
    () => ({
      pluginKey: 'agent-resource-mention-suggestion',
      char: '@',
      title: t('chat.input.resource_panel.title'),
      allowedPrefixes: [' ', '\n'],
      items: async ({ query }) => {
        const { accessiblePaths, files, setFiles, t } = resourceSuggestionStateRef.current
        if (accessiblePaths.length === 0) {
          return [
            {
              id: 'agent-resource:no-paths',
              label: t('chat.input.resource_panel.no_file_found.label'),
              description: t('chat.input.resource_panel.no_file_found.description'),
              disabled: true,
              command: () => undefined
            }
          ]
        }

        const searchPattern = query.trim() || '.'
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
              disabled: true,
              command: () => undefined
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
            id: token.id,
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
          }
        })
      }
    }),
    [t]
  )

  return useMemo(() => (enabled ? [resourceSuggestionSource] : []), [enabled, resourceSuggestionSource])
}
