import { useQuery } from '@data/hooks/useDataApi'
import { useAttachment } from '@renderer/hooks/useAttachment'
import { useExternalApps } from '@renderer/hooks/useExternalApps'
import FileManager from '@renderer/services/FileManager'
import { FILE_TYPE, type FileMetadata, type MCPTool } from '@renderer/types'
import { parseFileTypes } from '@renderer/utils'
import { buildEditorUrl } from '@renderer/utils/editorUtils'
import type { MCPProgressEvent } from '@shared/config/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import { IpcChannel } from '@shared/IpcChannel'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { MessageListActions, MessageListState } from '../types'
import { containsInlineAbsoluteFilePath } from '../utils/filePath'
import { type MessagePlatformActions, useMessagePlatformActions } from './useMessagePlatformActions'

type MessageLeafActions = Pick<
  MessageListActions,
  'previewFile' | 'subscribeToolProgress' | 'openExternalUrl' | 'openInExternalApp' | 'uploadEditorFiles'
> &
  MessagePlatformActions
type MessageLeafState = Pick<MessageListState, 'isToolAutoApproved' | 'externalCodeEditors'>

interface MessageLeafCapabilitiesParams {
  partsByMessageId: Record<string, CherryMessagePart[]>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMcpToolPart(part: CherryMessagePart): boolean {
  const partType = (part as { type?: string }).type
  if (partType === 'dynamic-tool') return true
  if (!partType?.startsWith('tool-')) return false

  const record = part as unknown as Record<string, unknown>
  const output = isRecord(record.output) ? record.output : undefined
  const outputMetadata = isRecord(output?.metadata) ? output.metadata : undefined
  if (outputMetadata?.type === 'mcp') return true

  const providerMetadata = isRecord(record.providerMetadata) ? record.providerMetadata : undefined
  const cherry = isRecord(providerMetadata?.cherry) ? providerMetadata.cherry : undefined
  const tool = isRecord(cherry?.tool) ? cherry.tool : undefined
  return tool?.type === 'mcp'
}

function hasExternalEditorPathHint(part: CherryMessagePart): boolean {
  const partType = (part as { type?: string }).type
  if (partType === 'dynamic-tool' || !!partType?.startsWith('tool-')) return true
  if (partType !== 'text') return false

  return containsInlineAbsoluteFilePath((part as { text?: string }).text)
}

export function useMessageLeafCapabilities({
  partsByMessageId
}: MessageLeafCapabilitiesParams): MessageLeafActions & MessageLeafState {
  const { t } = useTranslation()
  const { preview } = useAttachment()
  const platformActions = useMessagePlatformActions()
  const hasMcpToolParts = useMemo(
    () => Object.values(partsByMessageId).some((parts) => parts.some(isMcpToolPart)),
    [partsByMessageId]
  )
  const hasExternalEditorPathHints = useMemo(
    () => Object.values(partsByMessageId).some((parts) => parts.some(hasExternalEditorPathHint)),
    [partsByMessageId]
  )
  const { data: mcpServersData } = useQuery('/mcp-servers', { enabled: hasMcpToolParts })
  const { data: externalApps } = useExternalApps({ enabled: hasExternalEditorPathHints })
  const mcpServers = useMemo(() => mcpServersData?.items ?? [], [mcpServersData])
  const externalCodeEditors = useMemo(
    () => externalApps?.filter((app) => app.tags.includes('code-editor')) ?? [],
    [externalApps]
  )

  const previewFile = useCallback<NonNullable<MessageListActions['previewFile']>>(
    async (file) => {
      const fileType = parseFileTypes(file.type)
      if (fileType === null) {
        window.modal.error({ content: t('files.preview.error'), centered: true })
        return
      }

      await preview(FileManager.getSafePath(file), FileManager.formatFileName(file), fileType, file.ext)
    },
    [preview, t]
  )

  const subscribeToolProgress = useCallback<NonNullable<MessageListActions['subscribeToolProgress']>>(
    (toolId, onProgress) => {
      const removeListener = window.electron.ipcRenderer.on(
        IpcChannel.Mcp_Progress,
        (_event: Electron.IpcRendererEvent, data: MCPProgressEvent) => {
          if (data.callId === toolId) {
            onProgress(data.progress)
          }
        }
      )

      return removeListener
    },
    []
  )

  const openInExternalApp = useCallback<NonNullable<MessageListActions['openInExternalApp']>>((app, path) => {
    window.open(buildEditorUrl(app, path))
  }, [])

  const openExternalUrl = useCallback<NonNullable<MessageListActions['openExternalUrl']>>((url) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [])

  const uploadEditorFiles = useCallback<NonNullable<MessageListActions['uploadEditorFiles']>>(
    async (files: FileMetadata[]) => {
      const uploadedFiles = await FileManager.uploadFiles(files)
      return uploadedFiles.map((file) => {
        const isImage = file.type === FILE_TYPE.IMAGE
        return {
          type: 'file',
          mediaType: isImage ? `image/${file.ext.replace('.', '')}` : 'application/octet-stream',
          url: `file://${file.path}`,
          filename: file.origin_name || file.name
        } as CherryMessagePart
      })
    },
    []
  )

  const isToolAutoApproved = useCallback<NonNullable<MessageListState['isToolAutoApproved']>>(
    (tool: MCPTool, allowedTools?: string[]) => {
      if (allowedTools?.includes(tool.id)) return true
      if (tool.serverId === 'hub') return tool.name === 'list' || tool.name === 'inspect'
      const server = mcpServers.find((item) => item.id === tool.serverId)
      return server ? !server.disabledAutoApproveTools?.includes(tool.name) : false
    },
    [mcpServers]
  )

  return useMemo(
    () => ({
      previewFile,
      subscribeToolProgress,
      openExternalUrl,
      openInExternalApp,
      uploadEditorFiles,
      ...platformActions,
      isToolAutoApproved,
      externalCodeEditors
    }),
    [
      externalCodeEditors,
      isToolAutoApproved,
      openExternalUrl,
      openInExternalApp,
      platformActions,
      previewFile,
      subscribeToolProgress,
      uploadEditorFiles
    ]
  )
}
