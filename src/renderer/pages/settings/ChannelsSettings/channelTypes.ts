import type {
  AgentChannelType,
  CreateAgentChannelDto,
  UpdateAgentChannelDto
} from '@shared/data/api/schemas/agentChannels'
import type { AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'

type ChannelCreateDefaults = {
  [Type in AgentChannelType]: Readonly<Pick<Extract<CreateAgentChannelDto, { type: Type }>, 'type' | 'config'>>
}[AgentChannelType]

type ChannelDefinition = {
  name: string
  titleKey: string
  description: string
  available: boolean
  createDefaults: ChannelCreateDefaults
}

export type AvailableChannel = ChannelDefinition & { readonly type: AgentChannelType }

const CHANNEL_DEFINITIONS: ChannelDefinition[] = [
  {
    name: 'Feishu',
    titleKey: 'agent.channels.feishu.title',
    description: 'agent.channels.feishu.description',
    available: true,
    createDefaults: {
      type: 'feishu',
      config: {
        app_id: '',
        app_secret: '',
        encrypt_key: '',
        verification_token: '',
        allowed_chat_ids: [],
        domain: 'feishu'
      }
    }
  },
  {
    name: 'Telegram',
    titleKey: 'agent.channels.telegram.title',
    description: 'agent.channels.telegram.description',
    available: true,
    createDefaults: {
      type: 'telegram',
      config: { bot_token: '', allowed_chat_ids: [] }
    }
  },
  {
    name: 'QQ',
    titleKey: 'agent.channels.qq.title',
    description: 'agent.channels.qq.description',
    available: true,
    createDefaults: {
      type: 'qq',
      config: { app_id: '', client_secret: '', allowed_chat_ids: [], mention_only: true }
    }
  },
  {
    name: 'WeChat',
    titleKey: 'agent.channels.wechat.title',
    description: 'agent.channels.wechat.description',
    available: true,
    createDefaults: {
      type: 'wechat',
      config: { token_path: '', allowed_chat_ids: [] }
    }
  },
  {
    name: 'DingTalk',
    titleKey: 'agent.channels.dingtalk.title',
    description: 'agent.channels.dingtalk.description',
    available: true,
    createDefaults: {
      type: 'dingtalk',
      config: {
        client_id: '',
        client_secret: '',
        robot_code: '',
        card_template_id: '',
        allowed_chat_ids: [],
        allowed_user_ids: []
      }
    }
  },
  {
    name: 'WeCom',
    titleKey: 'agent.channels.wecom.title',
    description: 'agent.channels.wecom.description',
    available: true,
    createDefaults: {
      type: 'wecom',
      config: { bot_id: '', secret: '', allowed_chat_ids: [], allowed_user_ids: [] }
    }
  },
  {
    name: 'Discord',
    titleKey: 'agent.channels.discord.title',
    description: 'agent.channels.discord.description',
    available: true,
    createDefaults: {
      type: 'discord',
      config: { bot_token: '', allowed_channel_ids: [] }
    }
  },
  {
    name: 'Slack',
    titleKey: 'agent.channels.slack.title',
    description: 'agent.channels.slack.description',
    available: true,
    createDefaults: {
      type: 'slack',
      config: { bot_token: '', app_token: '', allowed_channel_ids: [] }
    }
  }
]

export const AVAILABLE_CHANNELS: AvailableChannel[] = CHANNEL_DEFINITIONS.map((definition) => ({
  ...definition,
  type: definition.createDefaults.type
}))

export type ChannelData = {
  id: string
  type: string
  name: string
  agentId?: string | null
  workspace?: AgentSessionWorkspaceSource
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Historical channel snapshots and partial form drafts are unvalidated; the save boundary applies the channel-specific schema.
  config: Record<string, unknown>
  isActive: boolean
  permissionMode?: string | null
  createdAt?: number | null
  updatedAt?: number | null
}

export type ChannelUpdates = Partial<ChannelData> & { configPatch?: UpdateAgentChannelDto['configPatch'] }
