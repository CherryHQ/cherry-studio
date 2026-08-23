import { Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import {
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

const MemorySettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [enabled, setEnabled] = usePreference('feature.memory.enabled')

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.memory.title')}</SettingTitle>
      <SettingDescription>{t('settings.memory.description')}</SettingDescription>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.memory.enabled')}</SettingRowTitle>
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => void setEnabled(checked)}
          aria-label={t('settings.memory.enabled')}
        />
      </SettingRow>
      <SettingRow>
        <SettingDescription>{t('settings.memory.hint')}</SettingDescription>
      </SettingRow>
    </SettingGroup>
  )
}

export default MemorySettings
