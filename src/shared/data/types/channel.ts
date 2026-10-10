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
  allowed_chat_ids: z.array(z.string()).default([]),
  mention_only: z.boolean().optional()
})

export type QQChannelConfig = z.infer<typeof QQChannelConfigSchema>

export const WeChatChannelConfigSchema = z.object({
  type: z.literal('wechat'),
  token_path: z.string(),
  allowed_chat_ids: z.array(z.string()).default([])
})

export type WeChatChannelConfig = z.infer<typeof WeChatChannelConfigSchema>

const WeComChatIdSchema = z
  .string()
  .trim()
  .regex(/^(dm|group):\S+$/)
const WeComUserIdSchema = z.string().trim().min(1)

export const WeComChannelConfigSchema = z.strictObject({
  type: z.literal('wecom'),
  bot_id: z.string().trim(),
  secret: z.string(),
  allowed_chat_ids: z
    .array(WeComChatIdSchema)
    .default([])
    .transform((ids) => [...new Set(ids)]),
  allowed_user_ids: z
    .array(WeComUserIdSchema)
    .default([])
    .transform((ids) => [...new Set(ids)])
})

export type WeComChannelConfig = z.infer<typeof WeComChannelConfigSchema>

export const DingTalkChannelConfigSchema = z.strictObject({
  type: z.literal('dingtalk'),
  client_id: z.string().trim(),
  client_secret: z.string(),
  robot_code: z.string().trim(),
  card_template_id: z.string().trim().optional(),
  allowed_chat_ids: z
    .array(
      z
        .string()
        .trim()
        .regex(/^(dm|group):\S+$/)
    )
    .default([])
    .transform((ids) => [...new Set(ids)]),
  allowed_user_ids: z
    .array(z.string().trim().min(1))
    .default([])
    .transform((ids) => [...new Set(ids)])
})

export type DingTalkChannelConfig = z.infer<typeof DingTalkChannelConfigSchema>

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

// ---- Discriminated union ----

export const ChannelConfigSchema = z.discriminatedUnion('type', [
  TelegramChannelConfigSchema,
  FeishuChannelConfigSchema,
  QQChannelConfigSchema,
  WeChatChannelConfigSchema,
  WeComChannelConfigSchema,
  DingTalkChannelConfigSchema,
  DiscordChannelConfigSchema,
  SlackChannelConfigSchema
])

export type ChannelConfig = z.infer<typeof ChannelConfigSchema>

export const CHANNEL_TYPES = ['telegram', 'feishu', 'qq', 'wechat', 'wecom', 'dingtalk', 'discord', 'slack'] as const
export type ChannelType = (typeof CHANNEL_TYPES)[number]

export interface ChannelStatus {
  channelId: string
  connected: boolean
  error?: string
}
