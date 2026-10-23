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
    groupKey: 'settings.general.sections.startup',
    aliases: ['auto start', '开机自启', '开机启动', '自启动']
  },
  {
    anchorId: 'launch-totray',
    titleKey: 'settings.launch.totray',
    groupKey: 'settings.general.sections.startup'
  },
  {
    anchorId: 'tray-show',
    titleKey: 'settings.tray.show',
    groupKey: 'settings.general.sections.startup'
  },
  {
    anchorId: 'tray-onclose',
    titleKey: 'settings.tray.onclose',
    groupKey: 'settings.general.sections.startup'
  },
  {
    anchorId: 'prevent-sleep-when-busy',
    titleKey: 'settings.power.prevent_sleep_when_busy',
    groupKey: 'settings.general.sections.runtime'
  },
  {
    anchorId: 'proxy-mode',
    titleKey: 'settings.proxy.mode.title',
    groupKey: 'settings.general.sections.network',
    descriptionKey: 'settings.proxy.mode.description',
    aliases: ['proxy', '代理']
  },
  {
    anchorId: 'allow-private-network',
    titleKey: 'settings.fetch.allow_private_network',
    groupKey: 'settings.general.sections.network'
  },
  {
    anchorId: 'hardware-acceleration',
    titleKey: 'settings.hardware_acceleration.title',
    groupKey: 'settings.general.sections.runtime',
    aliases: ['gpu']
  },
  {
    anchorId: 'commit-attribution',
    titleKey: 'settings.general.commit_attribution.title',
    groupKey: 'settings.general.sections.agent',
    descriptionKey: 'settings.general.commit_attribution.description',
    aliases: ['attribution', 'Co-Authored-By', 'Claude Code', '署名', '共同作者']
  },
  {
    anchorId: 'enable-developer-mode',
    titleKey: 'settings.developer.enable_developer_mode',
    groupKey: 'settings.general.sections.developer'
  },
  {
    anchorId: 'context-max-messages',
    titleKey: 'settings.models.context_management.max_messages',
    groupKey: 'settings.models.context_management.title',
    aliases: ['context count', '上下文数量']
  },
  {
    anchorId: 'context-enabled',
    titleKey: 'settings.models.context_management.enabled',
    groupKey: 'settings.models.context_management.title'
  },
  {
    anchorId: 'agent-language',
    titleKey: 'settings.agent.language.label',
    groupKey: 'settings.general.sections.agent',
    descriptionKey: 'settings.agent.language.description',
    aliases: ['language', 'agent language', 'reply language']
  },
  {
    anchorId: 'retry-enabled',
    titleKey: 'settings.general.retry.enabled',
    groupKey: 'settings.general.sections.retry',
    descriptionKey: 'settings.models.retry.description',
    aliases: ['retry', '重试']
  }
]
