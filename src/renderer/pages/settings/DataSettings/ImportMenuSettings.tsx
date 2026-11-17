import { ChevronDown } from 'lucide-react'
import { type FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, RowFlex } from '@cherrystudio/ui'
import { AgentSelector, type AgentSelectorItem } from '@renderer/components/resourceCatalog/selectors'
import {
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'

import { AgentImportPopup } from './AgentImportPopup'
import ImportPopup from './ImportPopup'

const ImportMenuOptions: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [agent, setAgent] = useState<AgentSelectorItem | null>(null)
  return (
    <SettingGroup theme={theme}>
      <SettingRow>
        <SettingTitle>{t('settings.data.import_settings.title')}</SettingTitle>
      </SettingRow>
      <SettingDivider />
      <SettingRow id="setting-data-import-deepseek" className="scroll-mt-6">
        <SettingRowTitle>{t('agent.import.title')}</SettingRowTitle>
        <RowFlex className="gap-2">
          <AgentSelector
            selectionType="item"
            value={agent}
            onChange={setAgent}
            align="end"
            trigger={
              <Button variant="outline" className="max-w-60">
                <span className="truncate">{agent?.name ?? t('chat.alerts.select_agent')}</span>
                <ChevronDown />
              </Button>
            }
          />
          <Button
            variant="outline"
            disabled={!agent}
            onClick={() => agent && AgentImportPopup.show({ agentId: agent.id })}>
            {t('settings.data.import_settings.button')}
          </Button>
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow id="setting-data-import-chatgpt" className="scroll-mt-6">
        <SettingRowTitle>{t('settings.data.import_settings.chatgpt')}</SettingRowTitle>
        <RowFlex className="justify-between gap-1.25">
          <Button onClick={() => ImportPopup.show({ source: 'chatgpt' })} variant="outline">
            {t('settings.data.import_settings.button')}
          </Button>
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow id="setting-data-import-claude" className="scroll-mt-6">
        <SettingRowTitle>{t('settings.data.import_settings.claude')}</SettingRowTitle>
        <RowFlex className="justify-between gap-1.25">
          <Button onClick={() => ImportPopup.show({ source: 'claude' })} variant="outline">
            {t('settings.data.import_settings.button')}
          </Button>
        </RowFlex>
      </SettingRow>
    </SettingGroup>
  )
}

export default ImportMenuOptions
