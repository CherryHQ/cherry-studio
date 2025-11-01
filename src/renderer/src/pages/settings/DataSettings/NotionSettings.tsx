import { Button, InfoTooltip, RowFlex, Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { Client } from '@notionhq/client'
import { AppLogo } from '@renderer/config/env'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { Space } from 'antd'
import { Input } from 'antd'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'

const NotionSettings: FC = () => {
  const [notionApiKey, setNotionApiKey] = usePreference('data.integration.notion.api_key')
  const [notionDatabaseID, setNotionDatabaseID] = usePreference('data.integration.notion.database_id')
  const [notionPageNameKey, setNotionPageNameKey] = usePreference('data.integration.notion.page_name_key')
  const [notionExportReasoning, setNotionExportReasoning] = usePreference('data.integration.notion.export_reasoning')

  const { t } = useTranslation()
  const { theme } = useTheme()
  const { openSmartMinapp } = useMinappPopup()

  const handleNotionTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNotionApiKey(e.target.value)
  }

  const handleNotionDatabaseIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNotionDatabaseID(e.target.value)
  }

  const handleNotionPageNameKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNotionPageNameKey(e.target.value)
  }

  const handleNotionConnectionCheck = () => {
    if (notionApiKey === null) {
      window.toast.error(t('settings.data.notion.check.empty_api_key'))
      return
    }
    if (notionDatabaseID === null) {
      window.toast.error(t('settings.data.notion.check.empty_database_id'))
      return
    }
    const notion = new Client({ auth: notionApiKey })
    notion.databases
      .retrieve({
        database_id: notionDatabaseID
      })
      .then((result) => {
        if (result) {
          window.toast.success(t('settings.data.notion.check.success'))
        } else {
          window.toast.error(t('settings.data.notion.check.fail'))
        }
      })
      .catch(() => {
        window.toast.error(t('settings.data.notion.check.error'))
      })
  }

  const handleNotionExportReasoningChange = (checked: boolean) => {
    setNotionExportReasoning(checked)
  }

  const handleNotionTitleClick = () => {
    openSmartMinapp({
      id: 'notion-help',
      name: 'Notion Help',
      url: 'https://docs.cherry-ai.com/advanced-basic/notion',
      logo: AppLogo
    })
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle style={{ justifyContent: 'flex-start', gap: 10 }}>
        {t('settings.data.notion.title')}
        <InfoTooltip
          content={t('settings.data.notion.help')}
          placement="right"
          iconProps={{ className: 'text-text-2 cursor-pointer' }}
          onClick={handleNotionTitleClick}
        />
      </SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.notion.database_id')}</SettingRowTitle>
        <RowFlex className="w-[315px] items-center gap-[5px]">
          <Input
            type="text"
            value={notionDatabaseID || ''}
            onChange={handleNotionDatabaseIdChange}
            onBlur={handleNotionDatabaseIdChange}
            placeholder={t('settings.data.notion.database_id_placeholder')}
          />
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.notion.page_name_key')}</SettingRowTitle>
        <RowFlex className="w-[315px] items-center gap-[5px]">
          <Input
            type="text"
            value={notionPageNameKey || ''}
            onChange={handleNotionPageNameKeyChange}
            onBlur={handleNotionPageNameKeyChange}
            placeholder={t('settings.data.notion.page_name_key_placeholder')}
          />
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.notion.api_key')}</SettingRowTitle>
        <RowFlex className="w-[315px] items-center gap-[5px]">
          <Space.Compact style={{ width: '100%' }}>
            <Input.Password
              value={notionApiKey || ''}
              onChange={handleNotionTokenChange}
              onBlur={handleNotionTokenChange}
              placeholder={t('settings.data.notion.api_key_placeholder')}
              style={{ width: '100%' }}
            />
            <Button onClick={handleNotionConnectionCheck}>{t('settings.data.notion.check.button')}</Button>
          </Space.Compact>
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.notion.export_reasoning.title')}</SettingRowTitle>
        <Switch checked={notionExportReasoning} onCheckedChange={handleNotionExportReasoningChange} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.notion.export_reasoning.help')}</SettingHelpText>
      </SettingRow>
    </SettingGroup>
  )
}

export default NotionSettings
