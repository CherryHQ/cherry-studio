import { CloudServerOutlined, CloudSyncOutlined, YuqueOutlined } from '@ant-design/icons'
import DividerWithText from '@renderer/components/DividerWithText'
import { JoplinIcon, SiyuanIcon } from '@renderer/components/Icons'
import { NutstoreIcon } from '@renderer/components/Icons/NutstoreIcons'
import { HStack } from '@renderer/components/Layout'
import ListItem from '@renderer/components/ListItem'
import { useTheme } from '@renderer/context/ThemeProvider'
import ImportMenuOptions from '@renderer/pages/settings/DataSettings/ImportMenuSettings'
import { FileText, FolderCog, FolderInput, FolderOpen } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer } from '..'
import BasicDataSettings from './BasicDataSettings'
import ExportMenuOptions from './ExportMenuSettings'
import JoplinSettings from './JoplinSettings'
import LocalBackupSettings from './LocalBackupSettings'
import MarkdownExportSettings from './MarkdownExportSettings'
import NotionSettings from './NotionSettings'
import NutstoreSettings from './NutstoreSettings'
import ObsidianSettings from './ObsidianSettings'
import S3Settings from './S3Settings'
import SiyuanSettings from './SiyuanSettings'
import WebDavSettings from './WebDavSettings'
import YuqueSettings from './YuqueSettings'

const DataSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [menu, setMenu] = useState<string>('data')

  const menuItems = [
    { key: 'divider_0', isDivider: true, text: t('settings.data.divider.basic') },
    { key: 'data', title: t('settings.data.data.title'), icon: <FolderCog size={16} /> },
    { key: 'divider_1', isDivider: true, text: t('settings.data.divider.cloud_storage') },
    { key: 'local_backup', title: t('settings.data.local.title'), icon: <FolderCog size={16} /> },
    { key: 'webdav', title: t('settings.data.webdav.title'), icon: <CloudSyncOutlined style={{ fontSize: 16 }} /> },
    { key: 'nutstore', title: t('settings.data.nutstore.title'), icon: <NutstoreIcon /> },
    { key: 's3', title: t('settings.data.s3.title.label'), icon: <CloudServerOutlined style={{ fontSize: 16 }} /> },
    { key: 'divider_2', isDivider: true, text: t('settings.data.divider.import_settings') },
    {
      key: 'import_settings',
      title: t('settings.data.import_settings.title'),
      icon: <FolderOpen size={16} />
    },
    { key: 'divider_3', isDivider: true, text: t('settings.data.divider.export_settings') },
    {
      key: 'export_menu',
      title: t('settings.data.export_menu.title'),
      icon: <FolderInput size={16} />
    },
    {
      key: 'markdown_export',
      title: t('settings.data.markdown_export.title'),
      icon: <FileText size={16} />
    },

    { key: 'divider_4', isDivider: true, text: t('settings.data.divider.third_party') },
    { key: 'notion', title: t('settings.data.notion.title'), icon: <i className="iconfont icon-notion" /> },
    {
      key: 'yuque',
      title: t('settings.data.yuque.title'),
      icon: <YuqueOutlined style={{ fontSize: 16 }} />
    },
    {
      key: 'joplin',
      title: t('settings.data.joplin.title'),
      icon: <JoplinIcon />
    },
    {
      key: 'obsidian',
      title: t('settings.data.obsidian.title'),
      icon: <i className="iconfont icon-obsidian" />
    },
    {
      key: 'siyuan',
      title: t('settings.data.siyuan.title'),
      icon: <SiyuanIcon />
    }
  ]

  return (
    <Container>
      <MenuList>
        {menuItems.map((item) =>
          item.isDivider ? (
            <DividerWithText key={item.key} text={item.text || ''} style={{ margin: '8px 0' }} /> // 动态传递分隔符文字
          ) : (
            <ListItem
              key={item.key}
              title={item.title}
              active={menu === item.key}
              onClick={() => setMenu(item.key)}
              titleStyle={{ fontWeight: 500 }}
              icon={item.icon}
            />
          )
        )}
      </MenuList>
      <SettingContainer theme={theme} style={{ display: 'flex', flex: 1, height: '100%' }}>
        {menu === 'data' && <BasicDataSettings />}
        {menu === 'webdav' && <WebDavSettings />}
        {menu === 'nutstore' && <NutstoreSettings />}
        {menu === 's3' && <S3Settings />}
        {menu === 'import_settings' && <ImportMenuOptions />}
        {menu === 'export_menu' && <ExportMenuOptions />}
        {menu === 'markdown_export' && <MarkdownExportSettings />}
        {menu === 'notion' && <NotionSettings />}
        {menu === 'yuque' && <YuqueSettings />}
        {menu === 'joplin' && <JoplinSettings />}
        {menu === 'obsidian' && <ObsidianSettings />}
        {menu === 'siyuan' && <SiyuanSettings />}
        {menu === 'local_backup' && <LocalBackupSettings />}
      </SettingContainer>
    </Container>
  )
}

const Container = styled(HStack)`
  flex: 1;
`

const MenuList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: var(--settings-width);
  padding: 12px;
  padding-bottom: 48px;
  border-right: 0.5px solid var(--color-border);
  height: 100vh;
  overflow: auto;
  box-sizing: border-box;
  min-height: 0;
  .iconfont {
    color: var(--color-text-2);
    line-height: 16px;
  }
`

export default DataSettings
