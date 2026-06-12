import * as z from 'zod'

// ---- Per-channel-type config schemas ----

export const TelegramChannelConfigSchema = z.object({
  type: z.literal('telegram'),
  bot_token: z.string(),
  allowed_chat_ids: z.array(z.string()).default([])
})

export type TelegramChannelConfig = z.infer<typeof TelegramChannelConfigSchema>

export const FeishuDomainSchema = z.enum(['feishu', 'lark'])
export type FeishuDomain = z.infer<typeof FeishuDomainSchema>

export const FeishuChannelConfigSchema = z.object({
  type: z.literal('feishu'),
  app_id: z.string(),
  app_secret: z.string(),
  encrypt_key: z.string(),
  verification_token: z.string(),
  allowed_chat_ids: z.array(z.string()).default([]),
  domain: FeishuDomainSchema
})

export type FeishuChannelConfig = z.infer<typeof FeishuChannelConfigSchema>

export const QQChannelConfigSchema = z.object({
  type: z.literal('qq'),
  app_id: z.string(),
  client_secret: z.string(),
  allowed_chat_ids: z.array(z.string()).default([])
})

export type QQChannelConfig = z.infer<typeof QQChannelConfigSchema>

export const WeChatChannelConfigSchema = z.object({
  type: z.literal('wechat'),
  token_path: z.string(),
  allowed_chat_ids: z.array(z.string()).default([])
})

export type WeChatChannelConfig = z.infer<typeof WeChatChannelConfigSchema>

export const DiscordChannelConfigSchema = z.object({
  type: z.literal('discord'),
  bot_token: z.string(),
  allowed_channel_ids: z.array(z.string()).default([])
})

export type DiscordChannelConfig = z.infer<typeof DiscordChannelConfigSchema>

export const SlackChannelConfigSchema = z.object({
  type: z.literal('slack'),
  bot_token: z.string(),
  app_token: z.string(),
  allowed_channel_ids: z.array(z.string()).default([])
})

export type SlackChannelConfig = z.infer<typeof SlackChannelConfigSchema>

export const WeComChannelConfigSchema = z.object({
  type: z.literal('wecom'),
  // Empty bot_id / bot_secret means "not yet bound" — the adapter will start the
  // QR registration flow on connect, and persist credentials via the
  // 'credentials' event once the user scans.
  bot_id: z.string().default(''),
  bot_secret: z.string().default(''),
  // Each entry is "chat_type:chatid", e.g. "1:zhangsan" (DM) or "2:wrxxxx" (group).
  // chat_type is required because WeCom does not return it from get_msg_chat_list.
  allowed_chat_ids: z.array(z.string()).default([])
})

export type WeComChannelConfig = z.infer<typeof WeComChannelConfigSchema>

export const DingTalkChannelConfigSchema = z.object({
  type: z.literal('dingtalk'),
  // Empty client_id / client_secret means "not yet bound" — the adapter will
  // start the Device Flow registration on connect and persist credentials via
  // the 'credentials' event once the user authorizes.
  client_id: z.string().default(''),
  client_secret: z.string().default(''),
  // Each entry is "<conversation_type>:<id>" — "p2p:<staffId>" (DM) or
  // "group:<openConversationId>" (group). Empty allows any chat (auto-tracked
  // into activeChatIds the first time a message arrives, mirroring Telegram).
  allowed_chat_ids: z.array(z.string()).default([])
})

export type DingTalkChannelConfig = z.infer<typeof DingTalkChannelConfigSchema>

// ---- Discriminated union ----

export const ChannelConfigSchema = z.discriminatedUnion('type', [
  TelegramChannelConfigSchema,
  FeishuChannelConfigSchema,
  QQChannelConfigSchema,
  WeChatChannelConfigSchema,
  DiscordChannelConfigSchema,
  SlackChannelConfigSchema,
  WeComChannelConfigSchema,
  DingTalkChannelConfigSchema
])

export type ChannelConfig = z.infer<typeof ChannelConfigSchema>

export const CHANNEL_TYPES = ['telegram', 'feishu', 'qq', 'wechat', 'discord', 'slack', 'wecom', 'dingtalk'] as const
export type ChannelType = (typeof CHANNEL_TYPES)[number]
