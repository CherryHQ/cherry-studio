import { HStack } from '@renderer/components/Layout'
import ImportPopup from '@renderer/components/Popups/ImportPopup'
import { useTheme } from '@renderer/context/ThemeProvider'
import { Button } from 'antd'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const ImportMenuOptions: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  return (
    <SettingGroup theme={theme}>
      <SettingRow>
        <SettingTitle>{t('settings.data.import_settings.title')}</SettingTitle>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.import_settings.chatgpt')}</SettingRowTitle>
        <HStack gap="5px" justifyContent="space-between">
          <Button onClick={() => ImportPopup.show('chatgpt')}>{t('settings.data.import_settings.button')}</Button>
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>
          {t('settings.data.import_settings.claude', { defaultValue: 'Import from Claude' })}
        </SettingRowTitle>
        <HStack gap="5px" justifyContent="space-between">
          <Button onClick={() => ImportPopup.show('claude')}>
            {t('settings.data.import_settings.button_folder', { defaultValue: 'Import Folder' })}
          </Button>
        </HStack>
      </SettingRow>
    </SettingGroup>
  )
}

export default ImportMenuOptions
