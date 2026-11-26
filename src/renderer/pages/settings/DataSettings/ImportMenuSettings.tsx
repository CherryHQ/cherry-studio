import type { FC, PropsWithChildren, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Avatar, AvatarImage, Button, InfoTooltip, RowFlex } from '@cherrystudio/ui'
import workbuddyIcon from '@renderer/assets/images/apps/workbuddy.png'
import { CliIcon } from '@renderer/components/icons/CliIcon'
import {
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import { openExternalWebsite } from '@renderer/services/website'
import { CodeCli } from '@shared/types/codeCli'

import { AgentImportPopup } from './AgentImportPopup'
import ImportPopup from './ImportPopup'
import LocalHistoryImportPopup from './LocalHistoryImportPopup'

function HistoryImportTitle({ icon, children }: PropsWithChildren<{ icon: ReactNode }>) {
  return (
    <SettingRowTitle className="gap-4">
      <Avatar aria-hidden="true" className="size-7 rounded-[32%] bg-muted ring-1 ring-border">
        {icon}
      </Avatar>
      {children}
    </SettingRowTitle>
  )
}

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
        <SettingRow id="setting-data-import-deepseek" className="scroll-mt-6">
          <SettingRowTitle className="gap-1.5">
            {t('agent.import.title')}
            <InfoTooltip
              ariaLabel={t('agent.import.guide')}
              content={t('agent.import.guide_description')}
              placement="right"
              onClick={() => void openExternalWebsite('https://chat.deepseek.com/')}
            />
          </SettingRowTitle>
          <RowFlex className="gap-2">
            <Button variant="outline" onClick={() => AgentImportPopup.show({})}>
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
      <SettingGroup theme={theme}>
        <SettingRow>
          <SettingTitle>{t('history_import.title')}</SettingTitle>
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-data-import-local-claude-code" className="scroll-mt-6 py-4">
          <HistoryImportTitle icon={<CliIcon id={CodeCli.CLAUDE_CODE} />}>
            {t('history_import.source.claude_code')}
          </HistoryImportTitle>
          <Button variant="outline" onClick={() => void LocalHistoryImportPopup.show({ source: 'claude-code' })}>
            {t('history_import.start')}
          </Button>
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-data-import-local-codex" className="scroll-mt-6 py-4">
          <HistoryImportTitle icon={<CliIcon id={CodeCli.OPENAI_CODEX} />}>
            {t('history_import.source.codex')}
          </HistoryImportTitle>
          <Button variant="outline" onClick={() => void LocalHistoryImportPopup.show({ source: 'codex' })}>
            {t('history_import.start')}
          </Button>
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-data-import-local-opencode" className="scroll-mt-6 py-4">
          <HistoryImportTitle icon={<CliIcon id={CodeCli.OPEN_CODE} />}>
            {t('history_import.source.opencode')}
          </HistoryImportTitle>
          <Button variant="outline" onClick={() => void LocalHistoryImportPopup.show({ source: 'opencode' })}>
            {t('history_import.start')}
          </Button>
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-data-import-local-workbuddy" className="scroll-mt-6 py-4">
          <HistoryImportTitle icon={<AvatarImage src={workbuddyIcon} alt="" className="scale-125" />}>
            {t('history_import.source.workbuddy')}
          </HistoryImportTitle>
          <Button
            variant="outline"
            disabled={!import.meta.env.DEV}
            title={!import.meta.env.DEV ? t('history_import.source_pending') : undefined}
            onClick={() => void LocalHistoryImportPopup.show({ source: 'workbuddy' })}>
            {t('history_import.start')}
          </Button>
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-data-import-local-dsh" className="scroll-mt-6 py-4">
          <HistoryImportTitle icon={<CliIcon id={CodeCli.DEEPSEEK_HARNESS} />}>
            {t('code.cli_tools.deepseek_harness')}
          </HistoryImportTitle>
          <Button
            variant="outline"
            disabled={!import.meta.env.DEV}
            title={!import.meta.env.DEV ? t('history_import.source_pending') : undefined}
            onClick={() => void LocalHistoryImportPopup.show({ source: 'dsh' })}>
            {t('history_import.start')}
          </Button>
        </SettingRow>
      </SettingGroup>
    </>
  )
}

export default ImportMenuOptions
