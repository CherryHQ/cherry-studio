import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Channel (WeChat / Feishu agent channels) IPC schemas. Per-adapter faces use a
 * three-segment subtype (channel.wechat.* / channel.feishu.*, precedent app.updater.*);
 * cross-subtype faces stay two-segment (channel.get_logs / get_statuses / status_changed /
 * log). Event payload shapes mirror ChannelLogEntry / ChannelStatusEvent (@main/ai/channels)
 * inline — @shared must not import @main; the producers are structurally compatible.
 *
 * The QR-login events are built from the REAL adapter broadcasts: no `agentId` (a phantom
 * field the old preload typing carried but no adapter ever sent nor any consumer read).
 */
const channelLogEntry = z.object({
  timestamp: z.number(),
  level: z.enum(['debug', 'info', 'warn', 'error']),
  message: z.string(),
  channelId: z.string()
})
const channelStatusEvent = z.object({
  channelId: z.string(),
  connected: z.boolean(),
  error: z.string().optional()
})

export const channelRequestSchemas = {
  'channel.wechat.has_credentials': defineRoute({
    input: z.string(),
    output: z.object({ exists: z.boolean(), userId: z.string().optional() })
  }),
  'channel.get_logs': defineRoute({ input: z.string(), output: z.array(channelLogEntry) }),
  'channel.get_statuses': defineRoute({ input: z.void(), output: z.array(channelStatusEvent) })
}

type QrStatus = 'pending' | 'confirmed' | 'expired' | 'disconnected'

export type ChannelEventSchemas = {
  'channel.status_changed': { channelId: string; connected: boolean; error?: string }
  'channel.log': { timestamp: number; level: 'debug' | 'info' | 'warn' | 'error'; message: string; channelId: string }
  'channel.wechat.qr_login': { channelId: string; url: string; status: QrStatus; userId?: string }
  'channel.feishu.qr_login': { channelId: string; url: string; status: QrStatus; appId?: string; appSecret?: string }
}
