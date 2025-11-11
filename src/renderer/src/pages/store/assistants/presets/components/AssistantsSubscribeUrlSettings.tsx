import { HStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '@renderer/pages/settings'
import { useAppDispatch } from '@renderer/store'
import { setAgentssubscribeUrl } from '@renderer/store/settings'
import Input from 'antd/es/input/Input'
import { HelpCircle } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

const AssistantsSubscribeUrlSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()

  const { agentssubscribeUrl } = useSettings()

  const handleAgentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setAgentssubscribeUrl(e.target.value))
  }

  const handleHelpClick = () => {
    window.open('https://docs.cherry-ai.com/data-settings/assistants-subscribe', '_blank')
  }

  return (
    <SettingGroup theme={theme}>
      <HStack alignItems="center" gap="8px">
        <SettingTitle>
          {t('assistants.presets.tag.agent')}
          {t('settings.tool.websearch.subscribe_add')}
        </SettingTitle>
        <HelpCircle
          size={16}
          color="var(--color-icon)"
          onClick={handleHelpClick}
          className="hover:!text-[var(--color-primary)] cursor-pointer transition-colors"
        />
      </HStack>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.tool.websearch.subscribe_url')}</SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="text"
            value={agentssubscribeUrl || ''}
            onChange={handleAgentChange}
            style={{ width: 315 }}
            placeholder={t('settings.tool.websearch.subscribe_url')}
          />
        </HStack>
      </SettingRow>
    </SettingGroup>
  )
}

export default AssistantsSubscribeUrlSettings
