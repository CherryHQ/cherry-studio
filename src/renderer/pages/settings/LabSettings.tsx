import { SegmentedControl } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import {
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingsContentColumn,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import type { NavigationLayout } from '@shared/data/preference/preferenceTypes'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

const LabSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [navigationLayout, setNavigationLayout] = usePreference('ui.navigation.layout')

  const navigationLayoutOptions = [
    { value: 'both', label: t('settings.lab.navigation_layout.both') },
    { value: 'sidebar', label: t('settings.lab.navigation_layout.sidebar') },
    { value: 'tabs', label: t('settings.lab.navigation_layout.tabs') }
  ] satisfies Array<{ value: NavigationLayout; label: string }>

  return (
    <SettingsContentColumn theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.lab.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.lab.navigation_layout.title')}</SettingRowTitle>
          <SegmentedControl<NavigationLayout>
            value={navigationLayout}
            onValueChange={(layout) => void setNavigationLayout(layout)}
            options={navigationLayoutOptions}
            size="sm"
          />
        </SettingRow>
      </SettingGroup>
    </SettingsContentColumn>
  )
}

export default LabSettings
