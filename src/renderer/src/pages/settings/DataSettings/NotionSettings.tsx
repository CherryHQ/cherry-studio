import { InfoCircleOutlined } from '@ant-design/icons'
import { Client } from '@notionhq/client'
import { HStack } from '@renderer/components/Layout'
import MinApp from '@renderer/components/MinApp'
import { useTheme } from '@renderer/context/ThemeProvider'
import { RootState, useAppDispatch } from '@renderer/store'
import {
  setNotionApiKey,
  setNotionAutoSplit,
  setNotionDatabaseID,
  setNotionPageNameKey,
  setNotionSplitSize
} from '@renderer/store/settings'
import { Button, InputNumber, Switch, Tooltip } from 'antd'
import Input from 'antd/es/input/Input'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'
const NotionSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()

  const notionApiKey = useSelector((state: RootState) => state.settings.notionApiKey)
  const notionDatabaseID = useSelector((state: RootState) => state.settings.notionDatabaseID)
  const notionPageNameKey = useSelector((state: RootState) => state.settings.notionPageNameKey)
  const notionAutoSplit = useSelector((state: RootState) => state.settings.notionAutoSplit)
  const notionSplitSize = useSelector((state: RootState) => state.settings.notionSplitSize)

  const handleNotionTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setNotionApiKey(e.target.value))
  }

  const handleNotionDatabaseIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setNotionDatabaseID(e.target.value))
  }

  const handleNotionPageNameKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setNotionPageNameKey(e.target.value))
  }

  const handleNotionConnectionCheck = () => {
    if (notionApiKey === null) {
      window.message.error(t('settings.data.notion.check.empty_api_key'))
      return
    }
    if (notionDatabaseID === null) {
      window.message.error(t('settings.data.notion.check.empty_database_id'))
      return
    }
    const notion = new Client({ auth: notionApiKey })
    notion.databases
      .retrieve({
        database_id: notionDatabaseID
      })
      .then((result) => {
        if (result) {
          window.message.success(t('settings.data.notion.check.success'))
        } else {
          window.message.error(t('settings.data.notion.check.fail'))
        }
      })
      .catch(() => {
        window.message.error(t('settings.data.notion.check.error'))
      })
  }

  const handleNotionTitleClick = () => {
    MinApp.start({
      id: 'notion-help',
      name: 'Notion Help',
      url: 'https://docs.cherry-ai.com/advanced-basic/notion'
    })
  }

  const handleNotionAutoSplitChange = (checked: boolean) => {
    dispatch(setNotionAutoSplit(checked))
  }

  const handleNotionSplitSizeChange = (value: number | null) => {
    if (value !== null) {
      dispatch(setNotionSplitSize(value))
    }
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle style={{ justifyContent: 'flex-start', gap: 10 }}>
        {t('settings.data.notion.title')}
        <Tooltip title={t('settings.data.notion.help')} placement="right">
          <InfoCircleOutlined
            style={{ color: 'var(--color-text-2)', cursor: 'pointer' }}
            onClick={handleNotionTitleClick}
          />
        </Tooltip>
      </SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.notion.database_id')}</SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="text"
            value={notionDatabaseID || ''}
            onChange={handleNotionDatabaseIdChange}
            onBlur={handleNotionDatabaseIdChange}
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
            onChange={handleNotionPageNameKeyChange}
            onBlur={handleNotionPageNameKeyChange}
            style={{ width: 315 }}
            placeholder={t('settings.data.notion.page_name_key_placeholder')}
          />
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.notion.api_key')}</SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="password"
            value={notionApiKey || ''}
            onChange={handleNotionTokenChange}
            onBlur={handleNotionTokenChange}
            style={{ width: 250 }}
            placeholder={t('settings.data.notion.api_key_placeholder')}
          />
          <Button onClick={handleNotionConnectionCheck}>{t('settings.data.notion.check.button')}</Button>
        </HStack>
      </SettingRow>
      <SettingDivider /> {/* 添加分割线 */}
      <SettingRow>
        <SettingRowTitle>
          <Tooltip title={t('settings.data.notion.auto_split_tip')} placement="right">
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {t('settings.data.notion.auto_split')}
              <InfoCircleOutlined style={{ cursor: 'pointer' }} />
            </span>
          </Tooltip>
        </SettingRowTitle>
        <Switch checked={notionAutoSplit} onChange={handleNotionAutoSplitChange} />
      </SettingRow>
      {notionAutoSplit && (
        <>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('settings.data.notion.split_size')}</SettingRowTitle>
            <InputNumber
              min={30}
              max={25000}
              value={notionSplitSize}
              onChange={handleNotionSplitSizeChange}
              keyboard={true}
              controls={true}
              style={{ width: 120 }}
            />
          </SettingRow>
          <SettingRow>
            <SettingHelpText style={{ marginLeft: 10 }}>{t('settings.data.notion.split_size_help')}</SettingHelpText>
          </SettingRow>
        </>
      )}
    </SettingGroup>
  )
}

export default NotionSettings
