import type { ModelSnapshot } from '@shared/data/types/message'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'

const SESSION_TOPIC_PREFIX = 'agent-session:'

export const buildAgentFileWorkspaceKey = (workspaceId?: string | null, workspacePath?: string): string => {
  return `${workspaceId ?? ''}\0${workspacePath ?? ''}`
}

export const buildAgentSessionTopicId = (sessionId: string): string => {
  return `${SESSION_TOPIC_PREFIX}${sessionId}`
}

export const extractAgentSessionIdFromTopicId = (topicId: string): string => {
  return topicId.replace(SESSION_TOPIC_PREFIX, '')
}

export const getAgentSessionModelFallbackSnapshot = (session: {
  modelId?: string | null
}): ModelSnapshot | undefined => {
  if (!session.modelId || !isUniqueModelId(session.modelId)) return undefined
  const { providerId, modelId } = parseUniqueModelId(session.modelId)
  return { id: modelId, name: modelId, provider: providerId }
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
