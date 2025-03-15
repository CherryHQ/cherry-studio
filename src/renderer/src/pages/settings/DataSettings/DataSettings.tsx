import {
  CloudSyncOutlined,
  DatabaseOutlined,
  FileMarkdownOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  SaveOutlined,
  YuqueOutlined
} from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import ListItem from '@renderer/components/ListItem'
import BackupPopup from '@renderer/components/Popups/BackupPopup'
import RestorePopup from '@renderer/components/Popups/RestorePopup'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useKnowledgeFiles } from '@renderer/hooks/useKnowledgeFiles'
import { reset } from '@renderer/services/BackupService'
import { AppInfo } from '@renderer/types'
import { formatFileSize } from '@renderer/utils'
import { Button, Typography } from 'antd'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'
import MarkdownExportSettings from './MarkdownExportSettings'
import NotionSettings from './NotionSettings'
import WebDavSettings from './WebDavSettings'
import YuqueSettings from './YuqueSettings'
import ObsidianSettings from './ObsidianSettings'
import ObsidianIcon from '@renderer/assets/images/apps/obsidian.svg'

const DataSettings: FC = () => {
  const { t } = useTranslation()
  const [appInfo, setAppInfo] = useState<AppInfo>()
  const { size, removeAllFiles } = useKnowledgeFiles()
  const { theme } = useTheme()
  const [menu, setMenu] = useState<string>('data')

  const menuItems = [
    { key: 'data', title: 'settings.data.data.title', icon: <DatabaseOutlined style={{ fontSize: 16 }} /> },
    { key: 'webdav', title: 'settings.data.webdav.title', icon: <CloudSyncOutlined style={{ fontSize: 16 }} /> },
    {
      key: 'markdown_export',
      title: 'settings.data.markdown_export.title',
      icon: <FileMarkdownOutlined style={{ fontSize: 16 }} />
    },
    { key: 'notion', title: 'settings.data.notion.title', icon: <i className="iconfont icon-notion" /> },
    { key: 'yuque', title: 'settings.data.yuque.title', icon: <YuqueOutlined style={{ fontSize: 16 }} /> },
    {
      key: 'obsidian',
      title: 'settings.data.obsidian.title',
      icon: <img src={ObsidianIcon} alt="obsidian" style={{ width: '16px', height: '16px' }} />
    }
  ]

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
    window.modal.confirm({
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
    window.modal.confirm({
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
    <Container>
      <MenuList>
        {menuItems.map((item) => (
          <ListItem
            key={item.key}
            title={t(item.title)}
            active={menu === item.key}
            onClick={() => setMenu(item.key)}
            titleStyle={{ fontWeight: 500 }}
            icon={item.icon}
          />
        ))}
      </MenuList>
      <SettingContainer theme={theme} style={{ display: 'flex', flex: 1 }}>
        {menu === 'data' && (
          <>
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
                    {t('settings.data.app_knowledge.button.delete')}
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
          </>
        )}
        {menu === 'webdav' && <WebDavSettings />}
        {menu === 'markdown_export' && <MarkdownExportSettings />}
        {menu === 'notion' && <NotionSettings />}
        {menu === 'yuque' && <YuqueSettings />}
        {menu === 'obsidian' && <ObsidianSettings />}
      </SettingContainer>
    </Container>
  )
}

const Container = styled(HStack)`
  flex: 1;
`

const StyledIcon = styled(FileSearchOutlined)`
  color: var(--color-text-2);
  cursor: pointer;
  transition: color 0.3s;

  &:hover {
    color: var(--color-text-1);
  }
`

const MenuList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: var(--settings-width);
  padding: 12px;
  border-right: 0.5px solid var(--color-border);
  height: 100%;
`

export default DataSettings
