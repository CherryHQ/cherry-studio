export type {
  ChannelAdapterConfig,
  ChannelCommandEvent,
  ChannelMessageEvent,
  SendMessageOptions
} from './ChannelAdapter'
export { ChannelAdapter } from './ChannelAdapter'
export { channelManager, registerAdapterFactory } from './ChannelManager'
export { ChannelMessageHandler, channelMessageHandler } from './ChannelMessageHandler'

// Register adapters (side-effect imports)
import './adapters/FeishuAdapter'
import './adapters/TelegramAdapter'
