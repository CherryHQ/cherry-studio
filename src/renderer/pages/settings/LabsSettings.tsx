import { useTranslation } from 'react-i18next'

import { SegmentedControl } from '@cherrystudio/ui'
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
          <SegmentedControl<'efficiency' | 'minimal'>
            aria-labelledby="interface-mode-label"
            className="shrink-0"
            value={mode}
            options={[
              { value: 'efficiency', label: t('settings.labs.efficiency') },
              { value: 'minimal', label: t('settings.labs.minimal') }
            ]}
            onValueChange={(value) => {
              void setMode(value).catch(() => toast.error(t('settings.labs.save_error')))
            }}
          />
        </SettingRow>
      </SettingGroup>
    </SettingsContentColumn>
  )
}
