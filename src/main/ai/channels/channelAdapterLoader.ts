import { application } from '@application'
import { CredentialStoreError } from '@main/services/credential'
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
      const id = channel.config.applicationCredentialId
      const read = id ? await application.get('CredentialStoreService').read(id) : null
      if (read && (read.status !== 'ok' || read.record.kind !== 'application'))
        throw new CredentialStoreError('missing')
      const payload = read?.status === 'ok' && read.record.kind === 'application' ? read.record.payload : undefined
      return createFeishuAdapter({
        channelId: channel.id,
        channelType: channel.type,
        agentId,
        channelConfig: {
          app_id: payload?.appId ?? '',
          app_secret: payload?.appSecret ?? '',
          encrypt_key: payload?.encryptKey ?? '',
          verification_token: payload?.verificationToken ?? '',
          domain: payload?.domain ?? channel.config.registrationDomain ?? 'feishu',
          allowed_chat_ids: channel.config.allowed_chat_ids
        }
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
    case 'dingtalk': {
      const { createDingTalkAdapter } = await import('./adapters/dingtalk/DingTalkAdapter')
      return createDingTalkAdapter({
        channelId: channel.id,
        channelType: channel.type,
        agentId,
        channelConfig: channel.config
      })
    }
    case 'wecom': {
      const { createWeComAdapter } = await import('./adapters/wecom/WeComAdapter')
      return createWeComAdapter({
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
