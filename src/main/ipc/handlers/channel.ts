import { application } from '@application'
import type { channelRequestSchemas } from '@shared/ipc/schemas/channel'
import type { IpcHandlersFor } from '@shared/ipc/types'
import fs from 'fs'

/**
 * Channel-domain request handlers. `wechat.has_credentials` is self-contained (reads the
 * bot token file, returns whether it exists) — it does not touch ChannelManager; the log /
 * status queries delegate to ChannelManager. The channel.* events are emitted by the
 * adapters / ChannelManager, not here.
 */
export const channelHandlers: IpcHandlersFor<typeof channelRequestSchemas> = {
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
  'channel.get_logs': async (channelId) => application.get('ChannelManager').getChannelLogs(channelId),
  'channel.get_statuses': async () => application.get('ChannelManager').getAllStatuses()
}
