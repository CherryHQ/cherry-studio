import type { SettingsSearchEntry } from '../settingsSearch/types'

export const route = '/settings/notifications'

export const entries: SettingsSearchEntry[] = [
  ...(['system', 'usage', 'official'] as const).map((category) => ({
    anchorId: `${category}-center`,
    titleKey: `notification.center.${category}`,
    groupKey: 'settings.notification.center'
  })),
  {
    anchorId: 'completion-sound',
    titleKey: 'settings.notification.completion_sound',
    groupKey: 'settings.notification.center'
  },
  {
    anchorId: 'daily-budget',
    titleKey: 'settings.notification.daily_budget',
    groupKey: 'settings.notification.center'
  },
  {
    anchorId: 'daily-threshold',
    titleKey: 'settings.notification.daily_threshold',
    groupKey: 'settings.notification.center'
  },
  {
    anchorId: 'system-popups',
    titleKey: 'settings.notification.system_popups',
    groupKey: 'settings.notification.popups'
  },
  {
    anchorId: 'usage-popups',
    titleKey: 'settings.notification.usage_popups',
    groupKey: 'settings.notification.popups'
  },
  {
    anchorId: 'assistant-notification',
    titleKey: 'settings.notification.assistant',
    groupKey: 'settings.notification.title'
  },
  {
    anchorId: 'backup-notification',
    titleKey: 'settings.notification.backup',
    groupKey: 'settings.notification.title'
  },
  {
    anchorId: 'knowledge-embed-notification',
    titleKey: 'settings.notification.knowledge_embed',
    groupKey: 'settings.notification.title'
  },
  {
    anchorId: 'update-notification',
    titleKey: 'settings.notification.update',
    groupKey: 'settings.notification.title'
  },
  {
    anchorId: 'mini-app-notification',
    titleKey: 'settings.notification.mini_app',
    groupKey: 'settings.notification.title'
  }
]
