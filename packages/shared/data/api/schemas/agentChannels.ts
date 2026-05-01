import * as z from 'zod'

import { AgentPermissionModeSchema } from './agents'

export const AgentChannelTypeSchema = z.enum(['telegram', 'feishu', 'qq', 'wechat', 'discord', 'slack'])
export type AgentChannelType = z.infer<typeof AgentChannelTypeSchema>

export const TelegramAgentChannelConfigSchema = z.strictObject({
  bot_token: z.string(),
  allowed_chat_ids: z.array(z.string()).optional()
})

export const FeishuDomainSchema = z.enum(['feishu', 'lark'])
export const FeishuAgentChannelConfigSchema = z.strictObject({
  app_id: z.string(),
  app_secret: z.string(),
  encrypt_key: z.string(),
  verification_token: z.string(),
  allowed_chat_ids: z.array(z.string()).optional(),
  domain: FeishuDomainSchema
})

export const QQAgentChannelConfigSchema = z.strictObject({
  app_id: z.string(),
  client_secret: z.string(),
  allowed_chat_ids: z.array(z.string()).optional()
})

export const WeChatAgentChannelConfigSchema = z.strictObject({
  token_path: z.string(),
  allowed_chat_ids: z.array(z.string()).optional()
})

export const DiscordAgentChannelConfigSchema = z.strictObject({
  bot_token: z.string(),
  allowed_channel_ids: z.array(z.string()).optional()
})

export const SlackAgentChannelConfigSchema = z.strictObject({
  bot_token: z.string(),
  app_token: z.string(),
  allowed_channel_ids: z.array(z.string()).optional()
})

export const AgentChannelConfigSchemasByType = {
  telegram: TelegramAgentChannelConfigSchema,
  feishu: FeishuAgentChannelConfigSchema,
  qq: QQAgentChannelConfigSchema,
  wechat: WeChatAgentChannelConfigSchema,
  discord: DiscordAgentChannelConfigSchema,
  slack: SlackAgentChannelConfigSchema
} as const satisfies Record<AgentChannelType, z.ZodType<Record<string, unknown>>>

export const ActiveAgentChannelConfigSchemasByType = {
  telegram: TelegramAgentChannelConfigSchema.extend({ bot_token: z.string().min(1) }),
  feishu: FeishuAgentChannelConfigSchema,
  qq: QQAgentChannelConfigSchema.extend({
    app_id: z.string().min(1),
    client_secret: z.string().min(1)
  }),
  wechat: WeChatAgentChannelConfigSchema,
  discord: DiscordAgentChannelConfigSchema.extend({ bot_token: z.string().min(1) }),
  slack: SlackAgentChannelConfigSchema.extend({
    bot_token: z.string().min(1),
    app_token: z.string().min(1)
  })
} as const satisfies Record<AgentChannelType, z.ZodType<Record<string, unknown>>>

export type TelegramAgentChannelConfig = z.infer<typeof TelegramAgentChannelConfigSchema>
export type FeishuAgentChannelConfig = z.infer<typeof FeishuAgentChannelConfigSchema>
export type QQAgentChannelConfig = z.infer<typeof QQAgentChannelConfigSchema>
export type WeChatAgentChannelConfig = z.infer<typeof WeChatAgentChannelConfigSchema>
export type DiscordAgentChannelConfig = z.infer<typeof DiscordAgentChannelConfigSchema>
export type SlackAgentChannelConfig = z.infer<typeof SlackAgentChannelConfigSchema>
export type AgentChannelConfig =
  | TelegramAgentChannelConfig
  | FeishuAgentChannelConfig
  | QQAgentChannelConfig
  | WeChatAgentChannelConfig
  | DiscordAgentChannelConfig
  | SlackAgentChannelConfig

const AgentChannelBaseFields = {
  id: z.string(),
  name: z.string(),
  agentId: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  isActive: z.boolean(),
  activeChatIds: z.array(z.string()).optional(),
  permissionMode: AgentPermissionModeSchema.nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
} as const

const MutableAgentChannelFields = {
  name: z.string(),
  agentId: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  isActive: z.boolean(),
  activeChatIds: z.array(z.string()).optional(),
  permissionMode: AgentPermissionModeSchema.nullable().optional()
} as const

function createAgentChannelEntitySchema<
  TType extends AgentChannelType,
  TConfig extends z.ZodType<Record<string, unknown>>
>(type: TType, configSchema: TConfig) {
  return z.strictObject({
    ...AgentChannelBaseFields,
    type: z.literal(type),
    config: configSchema
  })
}

function createAgentChannelMutationSchema<
  TType extends AgentChannelType,
  TConfig extends z.ZodType<Record<string, unknown>>
>(type: TType, configSchema: TConfig) {
  return z.strictObject({
    type: z.literal(type),
    ...MutableAgentChannelFields,
    config: configSchema
  })
}

export const TelegramAgentChannelEntitySchema = createAgentChannelEntitySchema(
  'telegram',
  TelegramAgentChannelConfigSchema
)
export const FeishuAgentChannelEntitySchema = createAgentChannelEntitySchema('feishu', FeishuAgentChannelConfigSchema)
export const QQAgentChannelEntitySchema = createAgentChannelEntitySchema('qq', QQAgentChannelConfigSchema)
export const WeChatAgentChannelEntitySchema = createAgentChannelEntitySchema('wechat', WeChatAgentChannelConfigSchema)
export const DiscordAgentChannelEntitySchema = createAgentChannelEntitySchema(
  'discord',
  DiscordAgentChannelConfigSchema
)
export const SlackAgentChannelEntitySchema = createAgentChannelEntitySchema('slack', SlackAgentChannelConfigSchema)

export const AgentChannelEntitySchema = z.discriminatedUnion('type', [
  TelegramAgentChannelEntitySchema,
  FeishuAgentChannelEntitySchema,
  QQAgentChannelEntitySchema,
  WeChatAgentChannelEntitySchema,
  DiscordAgentChannelEntitySchema,
  SlackAgentChannelEntitySchema
])
export type AgentChannelEntity = z.infer<typeof AgentChannelEntitySchema>

export const TelegramCreateAgentChannelSchema = createAgentChannelMutationSchema(
  'telegram',
  TelegramAgentChannelConfigSchema
)
export const FeishuCreateAgentChannelSchema = createAgentChannelMutationSchema('feishu', FeishuAgentChannelConfigSchema)
export const QQCreateAgentChannelSchema = createAgentChannelMutationSchema('qq', QQAgentChannelConfigSchema)
export const WeChatCreateAgentChannelSchema = createAgentChannelMutationSchema('wechat', WeChatAgentChannelConfigSchema)
export const DiscordCreateAgentChannelSchema = createAgentChannelMutationSchema(
  'discord',
  DiscordAgentChannelConfigSchema
)
export const SlackCreateAgentChannelSchema = createAgentChannelMutationSchema('slack', SlackAgentChannelConfigSchema)

export const CreateAgentChannelSchema = z.discriminatedUnion('type', [
  TelegramCreateAgentChannelSchema,
  FeishuCreateAgentChannelSchema,
  QQCreateAgentChannelSchema,
  WeChatCreateAgentChannelSchema,
  DiscordCreateAgentChannelSchema,
  SlackCreateAgentChannelSchema
])
export type CreateAgentChannelDto = z.infer<typeof CreateAgentChannelSchema>

export const UpdateAgentChannelSchema = z.strictObject({
  name: z.string().optional(),
  agentId: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  config: z
    .union([
      TelegramAgentChannelConfigSchema,
      FeishuAgentChannelConfigSchema,
      QQAgentChannelConfigSchema,
      WeChatAgentChannelConfigSchema,
      DiscordAgentChannelConfigSchema,
      SlackAgentChannelConfigSchema
    ])
    .optional(),
  isActive: z.boolean().optional(),
  activeChatIds: z.array(z.string()).optional(),
  permissionMode: AgentPermissionModeSchema.nullable().optional()
})
export type UpdateAgentChannelDto = z.infer<typeof UpdateAgentChannelSchema>

export const AgentChannelListQuerySchema = z.strictObject({
  agentId: z.string().optional(),
  type: AgentChannelTypeSchema.optional()
})
export type AgentChannelListQuery = z.infer<typeof AgentChannelListQuerySchema>

export type AgentChannelSchemas = {
  '/channels': {
    GET: {
      query?: AgentChannelListQuery
      response: AgentChannelEntity[]
    }
    POST: {
      body: CreateAgentChannelDto
      response: AgentChannelEntity
    }
  }

  '/channels/:channelId': {
    GET: {
      params: { channelId: string }
      response: AgentChannelEntity
    }
    PATCH: {
      params: { channelId: string }
      body: UpdateAgentChannelDto
      response: AgentChannelEntity
    }
    DELETE: {
      params: { channelId: string }
      response: void
    }
  }
}
