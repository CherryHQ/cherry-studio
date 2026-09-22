import type { SettingsSearchEntry } from '../settingsSearch/types'

export const route = '/settings/prometheus'

// Actionable rows only, per the convention the other leaves follow: the status line is a
// readout, not a control, so it is not indexed separately from the section title.
export const entries: SettingsSearchEntry[] = [
  {
    anchorId: 'skill-push',
    titleKey: 'settings.prometheus.push.title',
    groupKey: 'settings.prometheus.title',
    aliases: ['skills', 'claude', 'agents', 'home directory', '技能']
  },
  {
    anchorId: 'doctor-run',
    titleKey: 'settings.prometheus.doctor.title',
    groupKey: 'settings.prometheus.title',
    aliases: ['doctor', 'diagnostics', 'health', 'repair', '诊断']
  }
]
