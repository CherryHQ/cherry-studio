import fs from 'fs'

import { application } from '@application'
import { createAgentChannel, deleteAgentChannel, updateAgentChannel } from '@main/ai/channels'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'
import { channelErrorCodes } from '@shared/ipc/errors/channel'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { channelRequestSchemas } from '@shared/ipc/schemas/channel'
import type { IpcHandlersFor } from '@shared/ipc/types'

async function exposeChannelError<T>(operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
      throw new IpcError(channelErrorCodes.CHANNEL_NOT_FOUND, error.message)
    }
    if (isDataApiError(error) && error.code === ErrorCode.VALIDATION_ERROR) {
      throw new IpcError(channelErrorCodes.CHANNEL_CONFIG_INVALID, error.message, error.details)
    }
    throw error
  }
}

/**
 * Channel-domain request handlers. `wechat.has_credentials` is self-contained (reads the
 * bot token file, returns whether it exists) — it does not touch ChannelManager; the log /
 * log queries delegate to ChannelManager. The channel.* events are emitted by the adapters / ChannelManager.
 */
export const channelHandlers: IpcHandlersFor<typeof channelRequestSchemas> = {
  'channel.create': async (input) => exposeChannelError(() => createAgentChannel(input)),
  'channel.update': async ({ channelId, updates }) => exposeChannelError(() => updateAgentChannel(channelId, updates)),
  'channel.delete': async ({ channelId }) => {
    await exposeChannelError(async () => {
      if (!(await deleteAgentChannel(channelId))) {
        throw new IpcError(channelErrorCodes.CHANNEL_NOT_FOUND, `Channel with id '${channelId}' not found`)
      }
    })
  },
  'channel.wechat.has_credentials': async (channelId) => {
    const tokenPath = application.getPath('feature.agents.channels', `weixin_bot_${channelId}.json`)
    try {
      const raw = await fs.promises.readFile(tokenPath, 'utf8')
      const parsed = JSON.parse(raw)
      return { exists: true, userId: parsed.userId as string | undefined }
    } catch {
      return { exists: false }
    }
  },
  'channel.get_logs': async (channelId) => application.get('ChannelManager').getChannelLogs(channelId)
}
