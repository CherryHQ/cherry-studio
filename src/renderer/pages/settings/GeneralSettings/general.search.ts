import type { SettingsSearchEntry } from '../settingsSearch/types'

// Indexed rows = statically visible actionable rows (D8): conditional rows
// (custom-proxy inputs, developer client id, context-management and retry
// children behind their master switches) stay out — their anchors may not
// exist on jump.
export const route = '/settings/general'

export const entries: SettingsSearchEntry[] = [
  {
    anchorId: 'launch-onboot',
    titleKey: 'settings.launch.onboot',
    groupKey: 'settings.launch.title'
  },
  {
    anchorId: 'launch-totray',
    titleKey: 'settings.launch.totray',
    groupKey: 'settings.launch.title'
  },
  {
    anchorId: 'tray-show',
    titleKey: 'settings.tray.show',
    groupKey: 'settings.launch.title'
  },
  {
    anchorId: 'tray-onclose',
    titleKey: 'settings.tray.onclose',
    groupKey: 'settings.launch.title'
  },
  {
    anchorId: 'prevent-sleep-when-busy',
    titleKey: 'settings.power.prevent_sleep_when_busy',
    groupKey: 'settings.launch.title'
  },
  {
    anchorId: 'proxy-mode',
    titleKey: 'settings.proxy.mode.title',
    groupKey: 'settings.proxy.mode.title',
    aliases: ['proxy', '代理']
  },
  {
    anchorId: 'allow-private-network',
    titleKey: 'settings.fetch.allow_private_network',
    groupKey: 'settings.proxy.mode.title'
  },
  {
    anchorId: 'hardware-acceleration',
    titleKey: 'settings.hardware_acceleration.title',
    groupKey: 'settings.proxy.mode.title',
    aliases: ['gpu']
  },
  {
    anchorId: 'enable-developer-mode',
    titleKey: 'settings.developer.enable_developer_mode',
    groupKey: 'settings.developer.title'
  },
  {
    anchorId: 'context-max-messages',
    titleKey: 'settings.models.context_management.max_messages',
    groupKey: 'settings.models.context_management.title'
  },
  {
    anchorId: 'context-enabled',
    titleKey: 'settings.models.context_management.enabled',
    groupKey: 'settings.models.context_management.title'
  },
  {
    anchorId: 'retry-enabled',
    titleKey: 'settings.models.retry.label',
    groupKey: 'settings.models.retry.label',
    descriptionKey: 'settings.models.retry.description',
    aliases: ['retry', '重试']
  }
]
