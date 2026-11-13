import { useTranslation } from 'react-i18next'

import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@cherrystudio/ui'
import { SettingGroup, SettingRow } from '@renderer/components/SettingsPrimitives'
import type { NumberShortcutMode } from '@renderer/utils/numberShortcuts'
import { isMac } from '@renderer/utils/platform'

export function NumberShortcutSettings({
  mode,
  saving,
  onChange
}: {
  mode: NumberShortcutMode | 'custom'
  saving: boolean
  onChange: (mode: NumberShortcutMode) => void
}) {
  const { t } = useTranslation()
  const primary = isMac ? '⌘' : 'Ctrl+'
  const secondary = isMac ? '⌃' : 'Alt+'
  const conversationLabel = `${primary} 1–9 ${t('settings.shortcuts.number_keys.conversations')}`
  const tabLabel = `${primary} 1–9 ${t('settings.shortcuts.number_keys.tabs')}`
  return (
    <SettingGroup className="mb-6">
      <SettingRow id="setting-shortcut-number-keys" className="scroll-mt-6">
        <div className="min-w-0">
          <div className="font-medium text-sm">{t('settings.shortcuts.number_keys.title')}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {mode === 'custom'
              ? t('settings.shortcuts.number_keys.custom_description')
              : t('settings.shortcuts.number_keys.description', {
                  conversations: `${mode === 'conversation' ? primary : secondary} 1–9`,
                  tabs: `${mode === 'tab' ? primary : secondary} 1–9`
                })}
          </div>
        </div>
        <Select
          value={mode}
          disabled={saving}
          onValueChange={(value) => {
            if (value === 'conversation' || value === 'tab') onChange(value)
          }}>
          <SelectTrigger className="w-auto shrink-0 rounded-lg" aria-label={t('settings.shortcuts.number_keys.title')}>
            <SelectValue>
              {mode === 'conversation'
                ? conversationLabel
                : mode === 'tab'
                  ? tabLabel
                  : t('settings.shortcuts.number_keys.custom')}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="end" position="popper">
            <SelectItem value="tab">{tabLabel}</SelectItem>
            <SelectItem value="conversation">{conversationLabel}</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
    </SettingGroup>
  )
}
