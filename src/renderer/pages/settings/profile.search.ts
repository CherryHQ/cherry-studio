import type { SettingsSearchEntry } from './settingsSearch/types'

export const route = '/settings/profile'

export const entries: SettingsSearchEntry[] = [
  {
    anchorId: 'profile',
    titleKey: 'settings.profile.title',
    aliases: ['profile', 'avatar', 'nickname', '个人信息', '個人資訊', '头像', '昵称']
  }
]
