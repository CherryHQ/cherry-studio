import { useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type {
  MessageListActions,
  MessageListState,
  MessageStreamingLayers
} from '@renderer/components/chat/messages/types'
import { ipcApi } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import { FILE_TYPE, type FileMetadata } from '@renderer/types/file'
import type { McpTool } from '@renderer/types/tool'
import { safeOpen } from '@renderer/utils/file/safeOpen'
import type { FileHandle } from '@shared/data/types/file'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { AbsoluteFilePath } from '@shared/types/file'
import { getFileTypeByExt, isFilePathHandle } from '@shared/utils/file'
import dayjs from 'dayjs'
import type { TFunction } from 'i18next'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useAttachment } from './useAttachment'
import { type MessagePlatformActions, useMessagePlatformActions } from './useMessagePlatformActions'

const logger = loggerService.withContext('useMessageLeafCapabilities')

type MessageLeafActions = Pick<
  MessageListActions,
  'previewFile' | 'openFile' | 'subscribeToolProgress' | 'openExternalUrl'
> &
  MessagePlatformActions
type MessageLeafState = Pick<MessageListState, 'getFileView' | 'isToolAutoApproved'>

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

/** Ask Main where an entry lives; a path handle already carries its own answer. */
async function resolveHandlePath(handle: FileHandle): Promise<AbsoluteFilePath | undefined> {
  if (isFilePathHandle(handle)) return handle.path

  try {
    return await window.api.file.getPhysicalPath({ id: handle.entryId })
  } catch (error) {
    logger.warn('resolveHandlePath: no physical path for entry', { entryId: handle.entryId, error })
    return undefined
  }
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
function formatMessageAttachmentFileName(
  file: Pick<FileMetadata, 'origin_name' | 'ext' | 'created_at'>,
  t: TFunction
): string {
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
  const mcpServers = useMemo(() => mcpServersData?.items ?? [], [mcpServersData])

  const previewFile = useCallback<NonNullable<MessageListActions['previewFile']>>(
    async (target) => {
      if (getFileTypeByExt(target.ext) === FILE_TYPE.TEXT) {
        // Main owns path resolution; the inline text preview reads the path it hands back.
        const path = await resolveHandlePath(target.handle)
        if (path) {
          await preview(path, target.name, FILE_TYPE.TEXT, target.ext)
          return
        }
      }

      try {
        await safeOpen(target.handle)
      } catch {
        void popup.error({ content: t('files.preview.error'), centered: true })
      }
    },
    [preview, t]
  )

  const getFileView = useCallback<NonNullable<MessageListState['getFileView']>>(
    (file) => ({ displayName: formatMessageAttachmentFileName(file, t) }),
    [t]
  )

  const openFile = useCallback<NonNullable<MessageListActions['openFile']>>((target) => {
    return safeOpen(target.handle)
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
      ...platformActions,
      getFileView,
      isToolAutoApproved
    }),
    [getFileView, isToolAutoApproved, openExternalUrl, openFile, platformActions, previewFile, subscribeToolProgress]
  )
}
