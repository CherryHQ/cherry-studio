import type { SettingsSearchEntry } from '../settingsSearch/types'

export const route = '/settings/about'

// Actionable rows only: version info lines stay out per D8. The update rows
// sit inside `!isPortable` (portable builds hide them) — acceptable declared
// exception: normal builds always render them, portable jumps degrade silently.
export const entries: SettingsSearchEntry[] = [
  {
    anchorId: 'auto-check-update',
    titleKey: 'settings.general.auto_check_update.title',
    groupKey: 'settings.about.label',
    aliases: ['update', '更新']
  },
  {
    anchorId: 'diagnostics',
    titleKey: 'settings.doctor.entry.title',
    groupKey: 'settings.about.label',
    aliases: ['diagnostics', 'bundle', '诊断', '诊断包']
  }
]
