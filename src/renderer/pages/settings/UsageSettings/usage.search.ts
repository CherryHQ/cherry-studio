import type { SettingsSearchEntry } from '../settingsSearch/types'

export const route = '/settings/usage'

export const entries: SettingsSearchEntry[] = [
  {
    anchorId: 'profile',
    titleKey: 'settings.general.user_name.label',
    aliases: [
      'profile',
      'avatar',
      'nickname',
      '个人信息',
      '個人資訊',
      '头像',
      '昵称',
      '用量统计',
      '用量分析',
      'Usage Analytics'
    ]
  }
]
