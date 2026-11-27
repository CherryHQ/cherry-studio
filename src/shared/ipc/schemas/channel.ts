import * as z from 'zod'

import {
  AgentChannelEntitySchema,
  CreateAgentChannelSchema,
  UpdateAgentChannelSchema
} from '@shared/data/api/schemas/agentChannels'

import { defineRoute } from '../define'

/**
 * Channel (WeChat / Feishu agent channels) IPC schemas. Per-adapter faces use a
 * three-segment subtype (channel.wechat.* / channel.feishu.*, precedent app.updater.*);
 * cross-subtype faces stay two-segment (channel.get_logs / log). Event payload shapes mirror
 * ChannelLogEntry (@main/ai/channels)
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
const qrLoginRequest = z.strictObject({ channelId: z.string().min(1), requestId: z.uuid() })

export const channelRequestSchemas = {
  'channel.qr_login.begin': defineRoute({ input: qrLoginRequest, output: z.boolean() }),
  'channel.qr_login.cancel': defineRoute({ input: qrLoginRequest, output: z.void() }),
  'channel.registration.begin': defineRoute({
    input: z.strictObject({ channelId: z.string().min(1), requestId: z.uuid() }),
    output: z.object({ requestId: z.uuid(), url: z.string(), expiresAt: z.number() })
  }),
  'channel.registration.poll': defineRoute({
    input: z.strictObject({ requestId: z.uuid() }),
    output: z.object({ status: z.enum(['pending', 'confirmed', 'expired', 'cancelled', 'error']) })
  }),
  'channel.registration.cancel': defineRoute({
    input: z.strictObject({ requestId: z.uuid() }),
    output: z.void()
  }),
  'channel.create': defineRoute({ input: CreateAgentChannelSchema, output: AgentChannelEntitySchema }),
  'channel.update': defineRoute({
    input: z.strictObject({ channelId: z.string().min(1), updates: UpdateAgentChannelSchema }),
    output: AgentChannelEntitySchema
  }),
  'channel.delete': defineRoute({
    input: z.strictObject({ channelId: z.string().min(1) }),
    output: z.void()
  }),
  'channel.wechat.has_credentials': defineRoute({
    input: z.string(),
    output: z.object({ exists: z.boolean(), userId: z.string().optional() })
  }),
  'channel.get_logs': defineRoute({ input: z.string(), output: z.array(channelLogEntry) })
}

export type ChannelQrStatus = 'pending' | 'confirmed' | 'expired' | 'disconnected' | 'error'

export type ChannelEventSchemas = {
  'channel.qr_login.status': { channelId: string; requestId: string; url: string; status: ChannelQrStatus }
  'channel.log': { timestamp: number; level: 'debug' | 'info' | 'warn' | 'error'; message: string; channelId: string }
  'channel.wechat.qr_login': {
    channelId: string
    url: string
    status: ChannelQrStatus
    userId?: string
  }
  'channel.feishu.qr_login': {
    channelId: string
    url: string
    status: ChannelQrStatus
    appId?: string
    appSecret?: string
  }
}
