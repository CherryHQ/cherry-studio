/**
 * Compatibility re-export for the shared agents channels schema.
 *
 * The canonical table definition now lives under src/main/data/db/schemas.
 * TODO: Remove this file in a follow-up PR; import from @data/db/schemas/agentsChannels directly.
 */

export {
  type AgentsChannelRow as ChannelRow,
  agentsChannelsTable as channelsTable,
  type AgentsChannelTaskSubscriptionRow as ChannelTaskSubscriptionRow,
  agentsChannelTaskSubscriptionsTable as channelTaskSubscriptionsTable,
  type InsertAgentsChannelRow as InsertChannelRow,
  type InsertAgentsChannelTaskSubscriptionRow as InsertChannelTaskSubscriptionRow
} from '../../../../data/db/schemas/agentsChannels'
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
