export type {
  ChannelAdapterConfig,
  ChannelCommandEvent,
  ChannelMessageEvent,
  SendMessageOptions
} from './ChannelAdapter'
export { ChannelAdapter } from './ChannelAdapter'
export { channelManager, registerAdapterFactory } from './ChannelManager'
export { ChannelMessageHandler, channelMessageHandler } from './ChannelMessageHandler'
export { sessionStreamBus, type SessionStreamChunk } from './SessionStreamBus'
export { broadcastSessionChanged, registerSessionStreamIpc } from './sessionStreamIpc'

// Register adapters (side-effect imports)
import './adapters/discord/DiscordAdapter'
import './adapters/feishu/FeishuAdapter'
import './adapters/qq/QQAdapter'
import './adapters/slack/SlackAdapter'
import './adapters/telegram/TelegramAdapter'
import './adapters/wechat/WeChatAdapter'
