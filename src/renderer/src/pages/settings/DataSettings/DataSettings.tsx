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
import SiyuanSettings from './SiyuanSettings'
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

  const SiyuanIcon = () => (
    <svg viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="2962" width="16" height="16">
      <path
        d="M309.76 148.16a84.8 84.8 0 0 0-10.88 11.84S288 170.24 288 171.2s-6.72 4.8-6.72 6.72-3.52 1.92-2.88 2.88a12.48 12.48 0 0 0-6.4 6.4 121.28 121.28 0 0 0-20.8 19.2 456.64 456.64 0 0 1-37.76 37.12v2.88c0 2.88 0 0 0 0s-3.52 1.92-6.72 5.12c-8.64 9.28-19.84 20.48-28.16 28.16l-7.04 7.04-2.56 2.88a114.88 114.88 0 0 0-20.16 21.76 2.88 2.88 0 0 1-8 8.64l-1.6 1.6a99.52 99.52 0 0 0-19.52 18.88 21.44 21.44 0 0 0-6.4 5.44c-14.08 14.4-22.4 23.04-22.72 23.04l-9.28 8.96-8.96 8.96V887.04c0 1.28 3.2 2.56 6.72-1.92s3.52-3.84 4.16-3.84 0-1.6 0 0S163.84 800 219.84 744.64l38.4-38.08c16-16.32 29.12-29.76 28.8-30.4s6.72-4.16 5.76-5.76 5.44-3.2 5.44-5.12 23.68-23.04 23.04-26.56 0-115.52 0-252.16V138.56a128 128 0 0 0-11.84 10.88z m373.76 2.24a96 96 0 0 0-13.44 15.04s-33.92 32-76.48 74.56l-42.56 42.88L512 320v504.96s5.76-5.12 5.12-5.76a29.44 29.44 0 0 0 8.32-7.68c3.84-4.16 9.92-10.24 13.76-13.76l21.44-21.76 21.76-21.44c18.56-18.24 32-32 32-32l8.96-9.6a69.76 69.76 0 0 1 10.56-9.6s3.84-1.92 3.84-3.52 6.4-4.48 5.76-5.12 3.2-2.56 2.56-3.2 1.6 0 0 0 11.52-10.24 24-22.72l22.72-22.4v-256-251.84c0-0.96 0-2.24-15.36 11.84z"
        fill="#cdcdcd"
        p-id="2963"></path>
      <path
        d="M322.24 136h0c-1.6 0 0-0.64 0 0z m2.88 0v504.64l45.12 44.16c37.44 36.8 93.76 92.8 116.48 114.88l14.4 15.04a64 64 0 0 0 10.24 9.6V320l-4.8-4.48c-2.88-2.24-7.68-7.36-11.52-10.88l-42.24-41.92-20.8-21.12-16-14.4a76.48 76.48 0 0 1-7.36-7.04l-23.36-23.68-42.56-44.16c-15.04-15.04-16-16-17.6-14.72z m376 1.92V640l123.84 123.84c98.24 97.92 124.48 123.52 126.4 123.52h2.56V386.56l-124.8-124.8C760 192 704 136.96 704 136.96a3.52 3.52 0 0 0-1.6 2.56z"
        fill="#707070"
        p-id="2964"></path>
      <path
        d="M699.52 136.64V136z m-376.96 249.6V136.96s-0.32 50.56 0 249.28zM512 573.76v-127.04zM667.84 672l-6.72 7.36 7.04-7.04c6.72-6.08 7.68-7.36 6.72-7.36zM184 272.96v1.92l2.56-1.92c2.56-1.92 0-2.24 0-2.24a5.44 5.44 0 0 0-2.56 2.24zM141.76 314.88a2.24 2.24 0 0 0 1.92 0v-1.6z m483.2 399.04a71.36 71.36 0 0 0-8.96 10.24 69.76 69.76 0 0 0 10.56-9.6 56 56 0 0 0 8.96-10.24 73.28 73.28 0 0 0-10.56 9.6z m-448 75.52l-3.2 3.2 3.52-2.88 3.52-3.52s-2.56 0-5.44 3.2z m-97.92 96v1.92l2.88-1.92s1.92-2.24 0-2.24a6.72 6.72 0 0 0-4.48 2.88z"
        p-id="2965"></path>
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
    },
    {
      key: 'siyuan',
      title: 'settings.data.siyuan.title',
      icon: <SiyuanIcon />
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
        {menu === 'siyuan' && <SiyuanSettings />}
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
