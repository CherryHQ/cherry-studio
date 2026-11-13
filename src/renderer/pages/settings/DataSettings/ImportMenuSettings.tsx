import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, RowFlex } from '@cherrystudio/ui'
import { CliIcon } from '@renderer/components/icons/CliIcon'
import {
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import { CodeCli } from '@shared/types/codeCli'

import ImportPopup from './ImportPopup'
import LocalHistoryImportPopup from './LocalHistoryImportPopup'

const ImportMenuOptions: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  return (
    <>
      <SettingGroup theme={theme}>
        <SettingRow>
          <SettingTitle>{t('settings.data.import_settings.title')}</SettingTitle>
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
      <SettingGroup theme={theme}>
        <SettingRow>
          <SettingTitle>{t('history_import.title')}</SettingTitle>
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-data-import-local-claude-code" className="scroll-mt-6 py-4">
          <SettingRowTitle className="gap-4">
            <CliIcon id={CodeCli.CLAUDE_CODE} />
            {t('history_import.source.claude_code')}
          </SettingRowTitle>
          <Button variant="outline" onClick={() => void LocalHistoryImportPopup.show({ source: 'claude-code' })}>
            {t('history_import.start')}
          </Button>
        </SettingRow>
      </SettingGroup>
    </>
  )
}

export default ImportMenuOptions
