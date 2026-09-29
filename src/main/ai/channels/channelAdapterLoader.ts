import type { AgentChannelEntity } from '@shared/data/api/schemas/agentChannels'

import type { ChannelAdapter } from './ChannelAdapter'

export type ChannelAdapterLoader = (channel: AgentChannelEntity, agentId: string) => Promise<ChannelAdapter>

export const loadChannelAdapter: ChannelAdapterLoader = async (channel, agentId) => {
  switch (channel.type) {
    case 'discord': {
      const { createDiscordAdapter } = await import('./adapters/discord/DiscordAdapter')
      return createDiscordAdapter({
        channelId: channel.id,
        channelType: channel.type,
        agentId,
        channelConfig: channel.config
      })
    }
    case 'feishu': {
      const { createFeishuAdapter } = await import('./adapters/feishu/FeishuAdapter')
      return createFeishuAdapter({
        channelId: channel.id,
        channelType: channel.type,
        agentId,
        channelConfig: channel.config
      })
    }
    case 'qq': {
      const { createQqAdapter } = await import('./adapters/qq/QqAdapter')
      return createQqAdapter({
        channelId: channel.id,
        channelType: channel.type,
        agentId,
        channelConfig: channel.config
      })
    }
    case 'slack': {
      const { createSlackAdapter } = await import('./adapters/slack/SlackAdapter')
      return createSlackAdapter({
        channelId: channel.id,
        channelType: channel.type,
        agentId,
        channelConfig: channel.config
      })
    }
    case 'telegram': {
      const { createTelegramAdapter } = await import('./adapters/telegram/TelegramAdapter')
      return createTelegramAdapter({
        channelId: channel.id,
        channelType: channel.type,
        agentId,
        channelConfig: channel.config
      })
    }
    case 'wechat': {
      const { createWeChatAdapter } = await import('./adapters/wechat/WeChatAdapter')
      return createWeChatAdapter({
        channelId: channel.id,
        channelType: channel.type,
        agentId,
        channelConfig: channel.config
      })
    }
  }
}
