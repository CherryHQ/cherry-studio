import {
  CloudSyncOutlined,
  DatabaseOutlined,
  FileMarkdownOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  SaveOutlined,
  YuqueOutlined
} from '@ant-design/icons'
import { NutstoreIcon } from '@renderer/components/Icons/NutstoreIcons'
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
import JoplinSettings from './JoplinSettings'
import MarkdownExportSettings from './MarkdownExportSettings'
import NotionSettings from './NotionSettings'
import NutstoreSettings from './NutstoreSettings'
import ObsidianSettings from './ObsidianSettings'
import WebDavSettings from './WebDavSettings'
import YuqueSettings from './YuqueSettings'

const DataSettings: FC = () => {
  const { t } = useTranslation()
  const [appInfo, setAppInfo] = useState<AppInfo>()
  const { size, removeAllFiles } = useKnowledgeFiles()
  const { theme } = useTheme()
  const [menu, setMenu] = useState<string>('data')

  //joplin icon needs to be updated into iconfont
  const JoplinIcon = () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="grey" xmlns="http://www.w3.org/2000/svg">
      <path d="M20.97 0h-8.9a.15.15 0 00-.16.15v2.83c0 .1.08.17.18.17h1.22c.49 0 .89.38.93.86V17.4l-.01.36-.05.29-.04.13a2.06 2.06 0 01-.38.7l-.02.03a2.08 2.08 0 01-.37.34c-.5.35-1.17.5-1.92.43a4.66 4.66 0 01-2.67-1.22 3.96 3.96 0 01-1.34-2.42c-.1-.78.14-1.47.65-1.93l.07-.05c.37-.31.84-.5 1.39-.55a.09.09 0 00.01 0l.3-.01.35.01h.02a4.39 4.39 0 011.5.44c.15.08.17 0 .18-.06V9.63a.26.26 0 00-.2-.26 7.5 7.5 0 00-6.76 1.61 6.37 6.37 0 00-2.03 5.5 8.18 8.18 0 002.71 5.08A9.35 9.35 0 0011.81 24c1.88 0 3.62-.64 4.9-1.81a6.32 6.32 0 002.06-4.3l.01-10.86V4.08a.95.95 0 01.95-.93h1.22a.17.17 0 00.17-.17V.15a.15.15 0 00-.15-.15z" />
    </svg>
  )

  const menuItems = [
    { key: 'data', title: 'settings.data.data.title', icon: <DatabaseOutlined style={{ fontSize: 16 }} /> },
    { key: 'webdav', title: 'settings.data.webdav.title', icon: <CloudSyncOutlined style={{ fontSize: 16 }} /> },
    { key: 'nutstore', title: 'settings.data.nutstore.title', icon: <NutstoreIcon /> },
    {
      key: 'markdown_export',
      title: 'settings.data.markdown_export.title',
      icon: <FileMarkdownOutlined style={{ fontSize: 16 }} />
    },
    { key: 'notion', title: 'settings.data.notion.title', icon: <i className="iconfont icon-notion" /> },
    {
      key: 'yuque',
      title: 'settings.data.yuque.title',
      icon: <YuqueOutlined style={{ fontSize: 16 }} />
    },
    {
      key: 'obsidian',
      title: 'settings.data.obsidian.title',
      icon: <i className="iconfont icon-obsidian" />
    },
    {
      key: 'joplin',
      title: 'settings.data.joplin.title',
      //joplin icon needs to be updated into iconfont
      icon: <JoplinIcon />
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
        {menu === 'nutstore' && <NutstoreSettings />}
        {menu === 'markdown_export' && <MarkdownExportSettings />}
        {menu === 'notion' && <NotionSettings />}
        {menu === 'yuque' && <YuqueSettings />}
        {menu === 'obsidian' && <ObsidianSettings />}
        {menu === 'joplin' && <JoplinSettings />}
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
  .iconfont {
    color: var(--color-text-2);
    line-height: 16px;
  }
`

export default DataSettings
