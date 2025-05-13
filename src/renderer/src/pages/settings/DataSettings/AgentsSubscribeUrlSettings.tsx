
import { HStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { RootState, useAppDispatch } from '@renderer/store'
import { setAgentssubscribeUrl } from '@renderer/store/settings'
import Input from 'antd/es/input/Input'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const AgentsSubscribeUrlSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()

  const Aides = useSelector((state: RootState) => state.settings.agentssubscribeUrl)

  const handleAidesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setAgentssubscribeUrl(e.target.value))
  }



  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('agents.tag.agent')}{t('settings.websearch.subscribe_add')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.websearch.subscribe_url')}</SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="text"
            value={Aides || ''}
            onChange={handleAidesChange}
            style={{ width: 315 }}
            placeholder={t('settings.websearch.subscribe_name.placeholder')}
          />
        </HStack>
      </SettingRow>
      <SettingDivider />
    </SettingGroup>
  )
}

export default AgentsSubscribeUrlSettings