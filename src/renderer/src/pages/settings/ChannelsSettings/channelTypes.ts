export type AvailableChannel = {
  type: 'telegram' | 'feishu' | 'qq' | 'wechat' | 'discord'
  name: string
  description: string
  available: boolean
  defaultConfig: Record<string, unknown>
}

export const AVAILABLE_CHANNELS: AvailableChannel[] = [
  {
    type: 'feishu',
    name: 'Feishu',
    description: 'agent.cherryClaw.channels.feishu.description',
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
    description: 'agent.cherryClaw.channels.telegram.description',
    available: true,
    defaultConfig: { bot_token: '', allowed_chat_ids: [] }
  },
  {
    type: 'qq',
    name: 'QQ',
    description: 'agent.cherryClaw.channels.qq.description',
    available: true,
    defaultConfig: { app_id: '', client_secret: '', allowed_chat_ids: [] }
  },
  {
    type: 'wechat',
    name: 'WeChat',
    description: 'agent.cherryClaw.channels.wechat.description',
    available: true,
    defaultConfig: { token_path: '', allowed_chat_ids: [] }
  },
  {
    type: 'discord',
    name: 'Discord',
    description: 'agent.cherryClaw.channels.discord.description',
    available: true,
    defaultConfig: { bot_token: '', allowed_channel_ids: [] }
  }
]

export type ChannelData = {
  id: string
  type: string
  name: string
  agentId?: string | null
  sessionId?: string | null
  config: Record<string, unknown>
  isActive: boolean
  permissionMode?: string | null
  createdAt?: number | null
  updatedAt?: number | null
}
