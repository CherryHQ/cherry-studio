import { useQuery } from '@data/hooks/useDataApi'
import type {
  MessageListActions,
  MessageListState,
  MessageStreamingLayers
} from '@renderer/components/chat/messages/types'
import { useExternalApps } from '@renderer/hooks/useExternalApps'
import { ipcApi } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import type { FileMetadata } from '@renderer/types/file'
import type { McpTool } from '@renderer/types/tool'
import { buildEditorUrl } from '@renderer/utils/editor'
import { parseFileTypes } from '@renderer/utils/file'
import { safeOpen } from '@renderer/utils/file/safeOpen'
import type { FileHandle } from '@shared/data/types/file'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { FilePath } from '@shared/types/file'
import { createFileEntryHandle, createFilePathHandle, toSafeFileUrl } from '@shared/utils/file'
import dayjs from 'dayjs'
import type { TFunction } from 'i18next'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useAttachment } from './useAttachment'
import { type MessagePlatformActions, useMessagePlatformActions } from './useMessagePlatformActions'

type MessageLeafActions = Pick<
  MessageListActions,
  'previewFile' | 'openFile' | 'subscribeToolProgress' | 'openExternalUrl' | 'openInExternalApp'
> &
  MessagePlatformActions
type MessageLeafState = Pick<MessageListState, 'getFileView' | 'isToolAutoApproved' | 'externalCodeEditors'>

interface MessageLeafCapabilitiesParams {
  partsByMessageId: Record<string, CherryMessagePart[]>
  streamingLayers?: MessageStreamingLayers
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

function fileMetadataToHandle(file: FileMetadata): FileHandle {
  if (file.path) {
    try {
      return createFilePathHandle(file.path as FilePath)
    } catch {
      // Fall back to the entry id for legacy FileMetadata whose path is not an
      // absolute filesystem path. The IPC schema is still the authority.
    }
  }

  return createFileEntryHandle(file.id)
}

/**
 * Legacy chat-attachment display shim.
 *
 * Problem: the pasted-text / pasted-image branches infer user-visible meaning
 * from filename markers (`pasted_text`, `temp_file...image`). That is a leaky
 * v1 protocol from paste/temp-file producers. The long-text paste flow already
 * carries a composer kind while it is still in the composer, and pasted images
 * should likewise be identified at the producer boundary instead of by parsing
 * `origin_name` here. Keep this local while `FileMetadata` / sent file parts do
 * not carry a stable pasted-source field.
 */
function formatMessageAttachmentFileName(file: FileMetadata, t: TFunction): string {
  if (!file.origin_name) {
    return ''
  }

  const date = dayjs(file.created_at).format('YYYY-MM-DD')

  if (file.origin_name.includes('pasted_text')) {
    return date + ' ' + t('message.attachments.pasted_text') + file.ext
  }

  if (file.origin_name.startsWith('temp_file') && file.origin_name.includes('image')) {
    return date + ' ' + t('message.attachments.pasted_image') + file.ext
  }

  return file.origin_name
}

export function useMessageLeafCapabilities({
  partsByMessageId,
  streamingLayers
}: MessageLeafCapabilitiesParams): MessageLeafActions & MessageLeafState {
  const { t } = useTranslation()
  const { preview } = useAttachment()
  const platformActions = useMessagePlatformActions()
  const historyPartsByMessageId = streamingLayers?.historyPartsByMessageId
  const historyHasMcpToolParts = useMemo(
    () =>
      historyPartsByMessageId
        ? Object.values(historyPartsByMessageId).some((parts) => parts.some(isMcpToolPart))
        : false,
    [historyPartsByMessageId]
  )
  const hasMcpToolParts = useMemo(() => {
    if (!streamingLayers) {
      return Object.values(partsByMessageId).some((parts) => parts.some(isMcpToolPart))
    }
    if (historyHasMcpToolParts) return true
    return streamingLayers.liveMessageIds.some((messageId) => partsByMessageId[messageId]?.some(isMcpToolPart))
  }, [historyHasMcpToolParts, partsByMessageId, streamingLayers])
  const { data: mcpServersData } = useQuery('/mcp-servers', { enabled: hasMcpToolParts })
  const { data: externalApps } = useExternalApps()
  const mcpServers = useMemo(() => mcpServersData?.items ?? [], [mcpServersData])
  const externalCodeEditors = useMemo(
    () => externalApps?.filter((app) => app.tags.includes('code-editor')) ?? [],
    [externalApps]
  )

  const previewFile = useCallback<NonNullable<MessageListActions['previewFile']>>(
    async (file) => {
      const fileType = parseFileTypes(file.type)
      if (fileType === null) {
        void popup.error({ content: t('files.preview.error'), centered: true })
        return
      }

      if (fileType === 'text') {
        await preview(file.path, formatMessageAttachmentFileName(file, t), fileType, file.ext)
        return
      }

      try {
        await safeOpen(fileMetadataToHandle(file))
      } catch {
        void popup.error({ content: t('files.preview.error'), centered: true })
      }
    },
    [preview, t]
  )

  const getFileView = useCallback<NonNullable<MessageListState['getFileView']>>(
    (file) => {
      return {
        displayName: formatMessageAttachmentFileName(file, t),
        previewUrl: file.path ? toSafeFileUrl(file.path as FilePath, file.ext || null) : undefined
      }
    },
    [t]
  )

  const openFile = useCallback<NonNullable<MessageListActions['openFile']>>((file) => {
    return safeOpen(fileMetadataToHandle(file))
  }, [])

  const subscribeToolProgress = useCallback<NonNullable<MessageListActions['subscribeToolProgress']>>(
    (toolId, onProgress) => {
      const removeListener = ipcApi.on('mcp.tool.call_progress', (data) => {
        if (data.callId === toolId) {
          onProgress(data.progress)
        }
      })

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

  const isToolAutoApproved = useCallback<NonNullable<MessageListState['isToolAutoApproved']>>(
    (tool: McpTool, allowedTools?: string[]) => {
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
      openFile,
      subscribeToolProgress,
      openExternalUrl,
      openInExternalApp,
      ...platformActions,
      getFileView,
      isToolAutoApproved,
      externalCodeEditors
    }),
    [
      externalCodeEditors,
      getFileView,
      isToolAutoApproved,
      openExternalUrl,
      openFile,
      openInExternalApp,
      platformActions,
      previewFile,
      subscribeToolProgress
    ]
  )
}
