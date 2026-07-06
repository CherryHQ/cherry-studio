export type {
  ChannelAdapterConfig,
  ChannelCommandEvent,
  ChannelMessageEvent,
  SendMessageOptions
} from './ChannelAdapter'
export { ChannelAdapter } from './ChannelAdapter'
export { ChannelManager, registerAdapterFactory } from './ChannelManager'
export { ChannelMessageHandler, channelMessageHandler } from './ChannelMessageHandler'
export { sanitizeChannelOutput } from './security/OutputSanitizer'
export { resolveWorkspaceFile } from './security/WorkspaceFileGuard'
