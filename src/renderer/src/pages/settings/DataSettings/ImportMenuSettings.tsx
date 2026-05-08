import { Button, RowFlex } from '@cherrystudio/ui'
import ImportPopup from '@renderer/components/Popups/ImportPopup'
import { useTheme } from '@renderer/context/ThemeProvider'
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
        <RowFlex className="justify-between gap-1.25">
          <Button onClick={ImportPopup.show} variant="outline">
            {t('settings.data.import_settings.button')}
          </Button>
        </RowFlex>
      </SettingRow>
    </SettingGroup>
  )
}

export default ImportMenuOptions
