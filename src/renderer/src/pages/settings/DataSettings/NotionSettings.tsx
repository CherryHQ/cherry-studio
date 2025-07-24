import { InfoCircleOutlined } from '@ant-design/icons'
import { Client } from '@notionhq/client'
import { HStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { IntegrationType, useThirdPartyIntegration } from '@renderer/hooks/useThirdPartyIntegration'
import { RootState } from '@renderer/store'
import {
  setNotionApiKey,
  setNotionDatabaseID,
  setNotionExportReasoning,
  setNotionPageNameKey
} from '@renderer/store/settings'
import { Button, Space, Switch, Tooltip } from 'antd'
import { Input } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'
const NotionSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  const notionApiKey = useSelector((state: RootState) => state.settings.notionApiKey)
  const notionDatabaseID = useSelector((state: RootState) => state.settings.notionDatabaseID)
  const notionPageNameKey = useSelector((state: RootState) => state.settings.notionPageNameKey)
  const notionExportReasoning = useSelector((state: RootState) => state.settings.notionExportReasoning)

  const notionConfig = {
    type: 'notion' as IntegrationType,
    helpUrl: 'https://docs.cherry-ai.com/advanced-basic/notion',
    fieldSetters: {
      notionApiKey: setNotionApiKey,
      notionDatabaseID: setNotionDatabaseID,
      notionPageNameKey: setNotionPageNameKey,
      notionExportReasoning: setNotionExportReasoning
    },
    connectionCheckConfig: {
      requiredFields: ['notionApiKey', 'notionDatabaseID'],
      checkFunction: async (values, t) => {
        try {
          const notion = new Client({ auth: values.notionApiKey })
          const result = await notion.databases.retrieve({
            database_id: values.notionDatabaseID
          })
          if (result) {
            window.message.success(t('settings.data.notion.check.success'))
          } else {
            window.message.error(t('settings.data.notion.check.fail'))
          }
        } catch (e) {
          window.message.error(t('settings.data.notion.check.error'))
        }
      }
    }
  }

  const fieldValues = {
    notionApiKey,
    notionDatabaseID,
    notionPageNameKey,
    notionExportReasoning
  }

  const { handleInputChange, handleInputBlur, handleSwitchChange, handleConnectionCheck, handleHelpClick } =
    useThirdPartyIntegration(notionConfig, fieldValues)

  return (
    <SettingGroup theme={theme}>
      <SettingTitle style={{ justifyContent: 'flex-start', gap: 10 }}>
        {t('settings.data.notion.title')}
        <Tooltip title={t('settings.data.notion.help')} placement="right">
          <InfoCircleOutlined style={{ color: 'var(--color-text-2)', cursor: 'pointer' }} onClick={handleHelpClick} />
        </Tooltip>
      </SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.notion.database_id')}</SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="text"
            value={notionDatabaseID || ''}
            onChange={handleInputChange('notionDatabaseID')}
            onBlur={handleInputBlur('notionDatabaseID')}
            style={{ width: 315 }}
            placeholder={t('settings.data.notion.database_id_placeholder')}
          />
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.notion.page_name_key')}</SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="text"
            value={notionPageNameKey || ''}
            onChange={handleInputChange('notionPageNameKey')}
            onBlur={handleInputBlur('notionPageNameKey')}
            style={{ width: 315 }}
            placeholder={t('settings.data.notion.page_name_key_placeholder')}
          />
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.notion.api_key')}</SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Space.Compact style={{ width: '100%' }}>
            <Input.Password
              value={notionApiKey || ''}
              onChange={handleInputChange('notionApiKey')}
              onBlur={handleInputBlur('notionApiKey')}
              placeholder={t('settings.data.notion.api_key_placeholder')}
              style={{ width: '100%' }}
            />
            <Button onClick={handleConnectionCheck}>{t('settings.data.notion.check.button')}</Button>
          </Space.Compact>
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.notion.export_reasoning.title')}</SettingRowTitle>
        <Switch checked={notionExportReasoning} onChange={handleSwitchChange('notionExportReasoning')} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.notion.export_reasoning.help')}</SettingHelpText>
      </SettingRow>
    </SettingGroup>
  )
}

export default NotionSettings
