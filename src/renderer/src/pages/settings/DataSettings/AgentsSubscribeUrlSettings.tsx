import { HStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAppDispatch } from '@renderer/store'
import { setAgentssubscribeUrl } from '@renderer/store/settings'
import Input from 'antd/es/input/Input'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const AgentsSubscribeUrlSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()

  const { agentssubscribeUrl } = useSettings()

  const handleAgentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setAgentssubscribeUrl(e.target.value))
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>
        {t('agents.tag.agent')}
        {t('settings.tool.websearch.subscribe_add')}
      </SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.tool.websearch.subscribe_url')}</SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="text"
            value={agentssubscribeUrl || ''}
            onChange={handleAgentChange}
            style={{ width: 315 }}
            placeholder={t('settings.tool.websearch.subscribe_name.placeholder')}
          />
        </HStack>
      </SettingRow>
    </SettingGroup>
  )
}

export default AgentsSubscribeUrlSettings
