import { HStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { RootState, useAppDispatch } from '@renderer/store'
import { setefaultAides } from '@renderer/store/settings'
import Input from 'antd/es/input/Input'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const DefaultaidesSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()

  const Aides = useSelector((state: RootState) => state.settings.defaultaides)

  const handleAidesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setefaultAides(e.target.value))
  }



  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.default_aides.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.default_aides.repo_url')}</SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="text"
            value={Aides || ''}
            onChange={handleAidesChange}
            style={{ width: 315 }}
            placeholder={t('settings.data.default_aides.repo_url_placeholder')}
          />
        </HStack>
      </SettingRow>
      <SettingDivider />

    </SettingGroup>
  )
}

export default DefaultaidesSettings
