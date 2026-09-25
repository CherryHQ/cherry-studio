import { useTranslation } from 'react-i18next'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import {
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingsContentColumn,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { toast } from '@renderer/services/toast'

export function LabsSettings() {
  const { t } = useTranslation()
  const [mode, setMode] = usePreference('ui.mode', { optimistic: false })

  return (
    <SettingsContentColumn>
      <SettingGroup>
        <SettingTitle>{t('settings.labs.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow id="setting-labs-interface-mode">
          <div>
            <SettingRowTitle id="interface-mode-label">{t('settings.labs.mode')}</SettingRowTitle>
            <SettingDescription>{t('settings.labs.description')}</SettingDescription>
          </div>
          <Select
            value={mode}
            onValueChange={(value) => {
              if (value === 'minimal' || value === 'efficiency') {
                void setMode(value).catch(() => toast.error(t('settings.labs.save_error')))
              }
            }}>
            <SelectTrigger aria-labelledby="interface-mode-label" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="efficiency">{t('settings.labs.efficiency')}</SelectItem>
              <SelectItem value="minimal">{t('settings.labs.minimal')}</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
      </SettingGroup>
    </SettingsContentColumn>
  )
}
