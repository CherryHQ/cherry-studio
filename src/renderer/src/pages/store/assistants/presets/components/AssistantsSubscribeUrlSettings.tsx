import { RowFlex } from '@cherrystudio/ui'
import { Input } from '@cherrystudio/ui'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '@renderer/pages/settings'
import { useAppDispatch } from '@renderer/store'
import { setAgentssubscribeUrl } from '@renderer/store/settings'
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
      <RowFlex className="items-center gap-2">
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
      </RowFlex>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.tool.websearch.subscribe_url')}</SettingRowTitle>
        <RowFlex className="w-[315px] items-center gap-[5px]">
          <Input
            type="text"
            value={agentssubscribeUrl || ''}
            onChange={handleAgentChange}
            className="w-[315px]"
            placeholder={t('settings.tool.websearch.subscribe_url')}
          />
        </RowFlex>
      </SettingRow>
    </SettingGroup>
  )
}

export default AssistantsSubscribeUrlSettings
