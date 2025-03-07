import { useTheme } from '@renderer/context/ThemeProvider'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingGroup, SettingTitle } from '..'

const AdvancedSettings: FC = () => {
  const { t } = useTranslation()
  const { theme: themeMode } = useTheme()

  return (
    <SettingContainer theme={themeMode}>
      <SettingGroup>
        <SettingTitle>{t('settings.advanced.title')}</SettingTitle>
        <SettingDivider />
        {/* 高级设置的内容已移至显示设置下的分组设置 */}
      </SettingGroup>
    </SettingContainer>
  )
}

export default AdvancedSettings
