import * as z from 'zod'

import type { OffsetPaginationResponse } from '../apiTypes'
import { AgentPermissionModeSchema } from './agents'

export const ChannelTypeSchema = z.enum(['telegram', 'feishu', 'qq', 'wechat', 'discord', 'slack'])
export type ChannelType = z.infer<typeof ChannelTypeSchema>

export const TelegramChannelConfigSchema = z.strictObject({
  bot_token: z.string(),
  allowed_chat_ids: z.array(z.string()).optional()
})

export const FeishuDomainSchema = z.enum(['feishu', 'lark'])
export const FeishuChannelConfigSchema = z.strictObject({
  app_id: z.string(),
  app_secret: z.string(),
  encrypt_key: z.string(),
  verification_token: z.string(),
  allowed_chat_ids: z.array(z.string()).optional(),
  domain: FeishuDomainSchema
})

export const QQChannelConfigSchema = z.strictObject({
  app_id: z.string(),
  client_secret: z.string(),
  allowed_chat_ids: z.array(z.string()).optional()
})

export const WeChatChannelConfigSchema = z.strictObject({
  token_path: z.string(),
  allowed_chat_ids: z.array(z.string()).optional()
})

export const DiscordChannelConfigSchema = z.strictObject({
  bot_token: z.string(),
  allowed_channel_ids: z.array(z.string()).optional()
})

export const SlackChannelConfigSchema = z.strictObject({
  bot_token: z.string(),
  app_token: z.string(),
  allowed_channel_ids: z.array(z.string()).optional()
})

export const ChannelConfigSchemasByType = {
  telegram: TelegramChannelConfigSchema,
  feishu: FeishuChannelConfigSchema,
  qq: QQChannelConfigSchema,
  wechat: WeChatChannelConfigSchema,
  discord: DiscordChannelConfigSchema,
  slack: SlackChannelConfigSchema
} as const satisfies Record<ChannelType, z.ZodType<Record<string, unknown>>>

export const ActiveChannelConfigSchemasByType = {
  telegram: TelegramChannelConfigSchema.extend({ bot_token: z.string().min(1) }),
  feishu: FeishuChannelConfigSchema,
  qq: QQChannelConfigSchema.extend({
    app_id: z.string().min(1),
    client_secret: z.string().min(1)
  }),
  wechat: WeChatChannelConfigSchema,
  discord: DiscordChannelConfigSchema.extend({ bot_token: z.string().min(1) }),
  slack: SlackChannelConfigSchema.extend({
    bot_token: z.string().min(1),
    app_token: z.string().min(1)
  })
} as const satisfies Record<ChannelType, z.ZodType<Record<string, unknown>>>

export type TelegramChannelConfig = z.infer<typeof TelegramChannelConfigSchema>
export type FeishuChannelConfig = z.infer<typeof FeishuChannelConfigSchema>
export type QQChannelConfig = z.infer<typeof QQChannelConfigSchema>
export type WeChatChannelConfig = z.infer<typeof WeChatChannelConfigSchema>
export type DiscordChannelConfig = z.infer<typeof DiscordChannelConfigSchema>
export type SlackChannelConfig = z.infer<typeof SlackChannelConfigSchema>
export type ChannelConfig =
  | TelegramChannelConfig
  | FeishuChannelConfig
  | QQChannelConfig
  | WeChatChannelConfig
  | DiscordChannelConfig
  | SlackChannelConfig

const ChannelBaseFields = {
  id: z.string(),
  name: z.string(),
  agentId: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  isActive: z.boolean(),
  activeChatIds: z.array(z.string()).nullable().optional(),
  permissionMode: AgentPermissionModeSchema.nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
} as const

const MutableChannelFields = {
  name: z.string(),
  agentId: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  isActive: z.boolean(),
  activeChatIds: z.array(z.string()).nullable().optional(),
  permissionMode: AgentPermissionModeSchema.nullable().optional()
} as const

function createChannelEntitySchema<TType extends ChannelType, TConfig extends z.ZodType<Record<string, unknown>>>(
  type: TType,
  configSchema: TConfig
) {
  return z.strictObject({
    ...ChannelBaseFields,
    type: z.literal(type),
    config: configSchema
  })
}

function createChannelMutationSchema<TType extends ChannelType, TConfig extends z.ZodType<Record<string, unknown>>>(
  type: TType,
  configSchema: TConfig
) {
  return z.strictObject({
    type: z.literal(type),
    ...MutableChannelFields,
    config: configSchema
  })
}

export const TelegramChannelEntitySchema = createChannelEntitySchema('telegram', TelegramChannelConfigSchema)
export const FeishuChannelEntitySchema = createChannelEntitySchema('feishu', FeishuChannelConfigSchema)
export const QQChannelEntitySchema = createChannelEntitySchema('qq', QQChannelConfigSchema)
export const WeChatChannelEntitySchema = createChannelEntitySchema('wechat', WeChatChannelConfigSchema)
export const DiscordChannelEntitySchema = createChannelEntitySchema('discord', DiscordChannelConfigSchema)
export const SlackChannelEntitySchema = createChannelEntitySchema('slack', SlackChannelConfigSchema)

export const ChannelEntitySchema = z.discriminatedUnion('type', [
  TelegramChannelEntitySchema,
  FeishuChannelEntitySchema,
  QQChannelEntitySchema,
  WeChatChannelEntitySchema,
  DiscordChannelEntitySchema,
  SlackChannelEntitySchema
])
export type ChannelEntity = z.infer<typeof ChannelEntitySchema>

export const TelegramCreateChannelSchema = createChannelMutationSchema('telegram', TelegramChannelConfigSchema)
export const FeishuCreateChannelSchema = createChannelMutationSchema('feishu', FeishuChannelConfigSchema)
export const QQCreateChannelSchema = createChannelMutationSchema('qq', QQChannelConfigSchema)
export const WeChatCreateChannelSchema = createChannelMutationSchema('wechat', WeChatChannelConfigSchema)
export const DiscordCreateChannelSchema = createChannelMutationSchema('discord', DiscordChannelConfigSchema)
export const SlackCreateChannelSchema = createChannelMutationSchema('slack', SlackChannelConfigSchema)

export const CreateChannelSchema = z.discriminatedUnion('type', [
  TelegramCreateChannelSchema,
  FeishuCreateChannelSchema,
  QQCreateChannelSchema,
  WeChatCreateChannelSchema,
  DiscordCreateChannelSchema,
  SlackCreateChannelSchema
])
export type CreateChannelDto = z.infer<typeof CreateChannelSchema>

export const UpdateChannelSchema = z.strictObject({
  name: z.string().optional(),
  agentId: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
  activeChatIds: z.array(z.string()).nullable().optional(),
  permissionMode: AgentPermissionModeSchema.nullable().optional()
})
export type UpdateChannelDto = z.infer<typeof UpdateChannelSchema>

export const ChannelListQuerySchema = z.strictObject({
  agentId: z.string().optional(),
  type: ChannelTypeSchema.optional()
})
export type ChannelListQuery = z.infer<typeof ChannelListQuerySchema>

export type ChannelSchemas = {
  '/channels': {
    GET: {
      query?: ChannelListQuery
      response: ChannelEntity[]
    }
    POST: {
      body: CreateChannelDto
      response: ChannelEntity
    }
  }

  '/channels/:channelId': {
    GET: {
      params: { channelId: string }
      response: ChannelEntity
    }
    PATCH: {
      params: { channelId: string }
      body: UpdateChannelDto
      response: ChannelEntity
    }
    DELETE: {
      params: { channelId: string }
      response: void
    }
  }
}

export type ChannelListResponse = ChannelEntity[]
export type ChannelPageResponse = OffsetPaginationResponse<ChannelEntity>
