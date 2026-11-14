import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'

export type AvailableChannel = {
  type: 'telegram' | 'feishu' | 'qq' | 'wechat' | 'wecom' | 'dingtalk' | 'discord' | 'slack'
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
    defaultConfig: { app_id: '', client_secret: '', allowed_chat_ids: [], mention_only: true }
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
    type: 'dingtalk',
    name: 'DingTalk',
    titleKey: 'agent.channels.dingtalk.title',
    description: 'agent.channels.dingtalk.description',
    available: true,
    defaultConfig: {
      client_id: '',
      client_secret: '',
      robot_code: '',
      card_template_id: '',
      allowed_chat_ids: [],
      allowed_user_ids: []
    }
  },
  {
    type: 'wecom',
    name: 'WeCom',
    titleKey: 'agent.channels.wecom.title',
    description: 'agent.channels.wecom.description',
    available: true,
    defaultConfig: { bot_id: '', secret: '', allowed_chat_ids: [], allowed_user_ids: [] }
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

/** The add-channel menus lead with the platforms most users connect first. */
export const CHANNEL_MENU_PLATFORMS: AvailableChannel[] = (
  ['wechat', 'feishu', 'wecom', 'dingtalk', 'qq', 'telegram', 'discord', 'slack'] as const
).flatMap((type) => AVAILABLE_CHANNELS.filter((platform) => platform.type === type))

export type ChannelData = {
  id: string
  type: string
  name: string
  agentId?: string | null
  workspace?: AgentSessionWorkspaceSource
  config: Record<string, unknown>
  isActive: boolean
  permissionMode?: string | null
  createdAt?: number | null
  updatedAt?: number | null
}

export type ChannelUpdates = Partial<ChannelData> & { configPatch?: Record<string, unknown> }

/** Props every per-platform channel form takes. */
export type ChannelFormProps = {
  channel: ChannelData
  onConfigChange: (updates: ChannelUpdates) => void
  /** Not saved yet (the create wizard): flows that need a saved channel, such as QR login, are left out. */
  draft?: boolean
  /** The owning Agent's mode, named in the inherit option. */
  agentPermissionMode?: AgentPermissionMode
  /** Modes the owning Agent's runtime supports; every mode when omitted. */
  permissionModes?: readonly AgentPermissionMode[]
}
