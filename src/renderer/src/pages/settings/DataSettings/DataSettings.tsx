import { FileSearchOutlined, FolderOpenOutlined, InfoCircleOutlined, SaveOutlined } from '@ant-design/icons'
import { Client } from '@notionhq/client'
import { HStack } from '@renderer/components/Layout'
import MinApp from '@renderer/components/MinApp'
import BackupPopup from '@renderer/components/Popups/BackupPopup'
import RestorePopup from '@renderer/components/Popups/RestorePopup'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useKnowledgeFiles } from '@renderer/hooks/useKnowledgeFiles'
import { reset } from '@renderer/services/BackupService'
import { RootState, useAppDispatch } from '@renderer/store'
import {
  setNotionApiKey,
  setNotionAutoSplit,
  setNotionDatabaseID,
  setNotionPageNameKey,
  setNotionSplitSize,
  setYuqueRepoId,
  setYuqueToken,
  setYuqueUrl
} from '@renderer/store/settings'
import { AppInfo } from '@renderer/types'
import { formatFileSize } from '@renderer/utils'
import { Button, InputNumber, Modal, Switch, Tooltip, Typography } from 'antd'
import Input from 'antd/es/input/Input'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

import {
  SettingContainer,
  SettingDivider,
  SettingGroup,
  SettingHelpText,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '..'
import WebDavSettings from './WebDavSettings'

// 新增的 NotionSettings 组件
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

const YuqueSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()

  const yuqueToken = useSelector((state: RootState) => state.settings.yuqueToken)
  const yuqueUrl = useSelector((state: RootState) => state.settings.yuqueUrl)

  const handleYuqueTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setYuqueToken(e.target.value))
  }

  const handleYuqueRepoUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setYuqueUrl(e.target.value))
  }

  const handleYuqueConnectionCheck = async () => {
    if (!yuqueToken) {
      window.message.error(t('settings.data.yuque.check.empty_token'))
      return
    }
    if (!yuqueUrl) {
      window.message.error(t('settings.data.yuque.check.empty_url'))
      return
    }

    const response = await fetch('https://www.yuque.com/api/v2/hello', {
      headers: {
        'X-Auth-Token': yuqueToken
      }
    })

    if (!response.ok) {
      window.message.error(t('settings.data.yuque.check.fail'))
      return
    }
    const yuqueSlug = yuqueUrl.replace('https://www.yuque.com/', '')
    const repoIDResponse = await fetch(`https://www.yuque.com/api/v2/repos/${yuqueSlug}`, {
      headers: {
        'X-Auth-Token': yuqueToken
      }
    })
    if (!repoIDResponse.ok) {
      window.message.error(t('settings.data.yuque.check.fail'))
      return
    }
    const data = await repoIDResponse.json()
    dispatch(setYuqueRepoId(data.data.id))
    window.message.success(t('settings.data.yuque.check.success'))
  }

  const handleYuqueHelpClick = () => {
    MinApp.start({
      id: 'yuque-help',
      name: 'Yuque Help',
      url: 'https://www.yuque.com/settings/tokens'
    })
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.yuque.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.yuque.repo_url')}</SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="text"
            value={yuqueUrl || ''}
            onChange={handleYuqueRepoUrlChange}
            style={{ width: 315 }}
            placeholder={t('settings.data.yuque.repo_url_placeholder')}
          />
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>
          {t('settings.data.yuque.token')}
          <Tooltip title={t('settings.data.yuque.help')} placement="left">
            <InfoCircleOutlined
              style={{ color: 'var(--color-text-2)', cursor: 'pointer', marginLeft: 4 }}
              onClick={handleYuqueHelpClick}
            />
          </Tooltip>
        </SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="password"
            value={yuqueToken || ''}
            onChange={handleYuqueTokenChange}
            style={{ width: 250 }}
            placeholder={t('settings.data.yuque.token_placeholder')}
          />
          <Button onClick={handleYuqueConnectionCheck}>{t('settings.data.yuque.check.button')}</Button>
        </HStack>
      </SettingRow>
    </SettingGroup>
  )
}

const DataSettings: FC = () => {
  const { t } = useTranslation()
  const [appInfo, setAppInfo] = useState<AppInfo>()
  const { size, removeAllFiles } = useKnowledgeFiles()
  const { theme } = useTheme()

  useEffect(() => {
    window.api.getAppInfo().then(setAppInfo)
  }, [])

  const handleOpenPath = (path?: string) => {
    if (!path) return
    if (path?.endsWith('log')) {
      const dirPath = path.split(/[/\\]/).slice(0, -1).join('/')
      window.api.openPath(dirPath)
    } else {
      window.api.openPath(path)
    }
  }

  const handleClearCache = () => {
    Modal.confirm({
      title: t('settings.data.clear_cache.title'),
      content: t('settings.data.clear_cache.confirm'),
      okText: t('settings.data.clear_cache.button'),
      centered: true,
      okButtonProps: {
        danger: true
      },
      onOk: async () => {
        try {
          await window.api.clearCache()
          window.message.success(t('settings.data.clear_cache.success'))
        } catch (error) {
          window.message.error(t('settings.data.clear_cache.error'))
        }
      }
    })
  }

  const handleRemoveAllFiles = () => {
    Modal.confirm({
      centered: true,
      title: t('settings.data.app_knowledge.remove_all') + ` (${formatFileSize(size)}) `,
      content: t('settings.data.app_knowledge.remove_all_confirm'),
      onOk: async () => {
        await removeAllFiles()
        window.message.success(t('settings.data.app_knowledge.remove_all_success'))
      },
      okText: t('common.delete'),
      okButtonProps: {
        danger: true
      }
    })
  }

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.data.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.general.backup.title')}</SettingRowTitle>
          <HStack gap="5px" justifyContent="space-between">
            <Button onClick={BackupPopup.show} icon={<SaveOutlined />}>
              {t('settings.general.backup.button')}
            </Button>
            <Button onClick={RestorePopup.show} icon={<FolderOpenOutlined />}>
              {t('settings.general.restore.button')}
            </Button>
          </HStack>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.general.reset.title')}</SettingRowTitle>
          <HStack gap="5px">
            <Button onClick={reset} danger>
              {t('settings.general.reset.button')}
            </Button>
          </HStack>
        </SettingRow>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <WebDavSettings />
      </SettingGroup>
      <NotionSettings />
      <YuqueSettings />
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.data.data.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.data.app_data')}</SettingRowTitle>
          <HStack alignItems="center" gap="5px">
            <Typography.Text style={{ color: 'var(--color-text-3)' }}>{appInfo?.appDataPath}</Typography.Text>
            <StyledIcon onClick={() => handleOpenPath(appInfo?.appDataPath)} />
          </HStack>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.data.app_logs')}</SettingRowTitle>
          <HStack alignItems="center" gap="5px">
            <Typography.Text style={{ color: 'var(--color-text-3)' }}>{appInfo?.logsPath}</Typography.Text>
            <StyledIcon onClick={() => handleOpenPath(appInfo?.logsPath)} />
          </HStack>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.data.app_knowledge')}</SettingRowTitle>
          <HStack alignItems="center" gap="5px">
            <Button onClick={handleRemoveAllFiles} danger>
              {t('settings.data.app_knowledge.remove_all')}
            </Button>
          </HStack>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.data.clear_cache.title')}</SettingRowTitle>
          <HStack gap="5px">
            <Button onClick={handleClearCache} danger>
              {t('settings.data.clear_cache.button')}
            </Button>
          </HStack>
        </SettingRow>
      </SettingGroup>
    </SettingContainer>
  )
}

const StyledIcon = styled(FileSearchOutlined)`
  color: var(--color-text-2);
  cursor: pointer;
  transition: color 0.3s;

  &:hover {
    color: var(--color-text-1);
  }
`

export default DataSettings
