/**
 * Compatibility re-export for the shared agent channel schema.
 *
 * The canonical table definition now lives under src/main/data/db/schemas.
 * TODO: Remove this file in a follow-up PR; import from @data/db/schemas/agentChannel directly.
 */

export {
  type AgentChannelRow as ChannelRow,
  agentChannelTable as channelsTable,
  type AgentChannelTaskRow as ChannelTaskSubscriptionRow,
  agentChannelTaskTable as channelTaskSubscriptionsTable,
  type InsertAgentChannelRow as InsertChannelRow,
  type InsertAgentChannelTaskRow as InsertChannelTaskSubscriptionRow
} from '../../../../data/db/schemas/agentChannel'
export type {
  ChannelConfig,
  DiscordChannelConfig,
  FeishuChannelConfig,
  FeishuDomain,
  QQChannelConfig,
  SlackChannelConfig,
  TelegramChannelConfig,
  WeChatChannelConfig
} from './channelConfig'
export { ChannelConfigSchema } from './channelConfig'
