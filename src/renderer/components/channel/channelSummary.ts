import type { TFunction } from 'i18next'

import { permissionModeCards } from '@renderer/utils/agent'

import type { ChannelData } from './channelTypes'

/** One-line channel summary: Feishu domain, allowed chats, and the permission mode in force. */
export function channelSummary(
  t: TFunction,
  channel: Pick<ChannelData, 'type' | 'config' | 'permissionMode'>,
  agentPermissionMode: string | undefined
): string {
  const modeTitle = (mode: string | null | undefined) => {
    const card = permissionModeCards.find((item) => item.mode === mode)
    return card ? t(card.titleKey, card.titleFallback) : ''
  }
  const ids = (channel.config.allowed_chat_ids ?? channel.config.allowed_channel_ids ?? []) as string[]
  return [
    channel.type === 'feishu'
      ? t(channel.config.domain === 'lark' ? 'agent.channels.feishu.domainLark' : 'agent.channels.feishu.domainFeishu')
      : null,
    ids.length
      ? t('library.config.dialogs.create.channels.chats_count', { count: ids.length })
      : t('library.config.dialogs.create.channels.chats_all'),
    channel.permissionMode
      ? t('library.config.dialogs.create.channels.permission', { mode: modeTitle(channel.permissionMode) })
      : t('library.config.dialogs.create.channels.permission_inherit', { mode: modeTitle(agentPermissionMode) })
  ]
    .filter(Boolean)
    .join(' · ')
}
