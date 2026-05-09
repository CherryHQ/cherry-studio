import type { ApiModelsFilter } from '@renderer/types'
import type { AgentType } from '@shared/data/types/agent'

const SESSION_TOPIC_PREFIX = 'agent-session:'

export const buildAgentSessionTopicId = (sessionId: string): string => {
  return `${SESSION_TOPIC_PREFIX}${sessionId}`
}

export const isAgentSessionTopicId = (topicId: string): boolean => {
  return topicId.startsWith(SESSION_TOPIC_PREFIX)
}

export const extractAgentSessionIdFromTopicId = (topicId: string): string => {
  return topicId.replace(SESSION_TOPIC_PREFIX, '')
}

import discordIcon from '@renderer/assets/images/channel/discord.svg'
import feishuIcon from '@renderer/assets/images/channel/feishu.jpeg'
import qqIcon from '@renderer/assets/images/channel/qq.svg'
import slackIcon from '@renderer/assets/images/channel/slack.svg'
import telegramIcon from '@renderer/assets/images/channel/telegram.png'
import wechatIcon from '@renderer/assets/images/channel/wechat.png'

const CHANNEL_TYPE_ICONS: Record<string, string> = {
  telegram: telegramIcon,
  feishu: feishuIcon,
  qq: qqIcon,
  wechat: wechatIcon,
  discord: discordIcon,
  slack: slackIcon
}

export const getChannelTypeIcon = (channelType: string | undefined): string | undefined => {
  if (!channelType) return undefined
  return CHANNEL_TYPE_ICONS[channelType]
}

export const getModelFilterByAgentType = (_type: AgentType): ApiModelsFilter => {
  // TODO: provider-type filtering dropped with v1 ProviderTypeSchema removal;
  // reintroduce via UniqueModelId-aware filter if/when claude-code needs it again.
  return {}
}
