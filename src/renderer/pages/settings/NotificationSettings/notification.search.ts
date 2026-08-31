import type { SettingsSearchEntry } from '../settingsSearch/types'

export const route = '/settings/notifications'

export const entries: SettingsSearchEntry[] = [
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
