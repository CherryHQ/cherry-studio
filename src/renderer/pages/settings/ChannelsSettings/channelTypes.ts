import type { AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'

export type AvailableChannel = {
  type: 'telegram' | 'feishu' | 'qq' | 'wechat' | 'discord' | 'slack'
  name: string
  titleKey: string
  description: string
  available: boolean
  defaultConfig: Record<string, unknown>
}

export const AVAILABLE_CHANNELS: AvailableChannel[] = [
  {
    type: 'feishu',
    name: 'Feishu',
    titleKey: 'agent.channels.feishu.title',
    description: 'agent.channels.feishu.description',
    available: true,
    defaultConfig: {
      app_id: '',
      app_secret: '',
      encrypt_key: '',
      verification_token: '',
      allowed_chat_ids: [],
      domain: 'feishu'
    }
  },
  {
    type: 'telegram',
    name: 'Telegram',
    titleKey: 'agent.channels.telegram.title',
    description: 'agent.channels.telegram.description',
    available: true,
    defaultConfig: { bot_token: '', allowed_chat_ids: [] }
  },
  {
    type: 'qq',
    name: 'QQ',
    titleKey: 'agent.channels.qq.title',
    description: 'agent.channels.qq.description',
    available: true,
    defaultConfig: { app_id: '', client_secret: '', allowed_chat_ids: [] }
  },
  {
    type: 'wechat',
    name: 'WeChat',
    titleKey: 'agent.channels.wechat.title',
    description: 'agent.channels.wechat.description',
    available: true,
    defaultConfig: { token_path: '', allowed_chat_ids: [] }
  },
  {
    type: 'discord',
    name: 'Discord',
    titleKey: 'agent.channels.discord.title',
    description: 'agent.channels.discord.description',
    available: true,
    defaultConfig: { bot_token: '', allowed_channel_ids: [] }
  },
  {
    type: 'slack',
    name: 'Slack',
    titleKey: 'agent.channels.slack.title',
    description: 'agent.channels.slack.description',
    available: true,
    defaultConfig: { bot_token: '', app_token: '', allowed_channel_ids: [] }
  }
]

export type ChannelData = {
  id: string
  type: string
  name: string
  agentId?: string | null
  sessionId?: string | null
  workspace?: AgentSessionWorkspaceSource
  config: Record<string, unknown>
  isActive: boolean
  permissionMode?: string | null
  createdAt?: number | null
  updatedAt?: number | null
}
