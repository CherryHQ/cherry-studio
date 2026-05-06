import { CloudServerOutlined, CloudSyncOutlined } from '@ant-design/icons'
import { MenuDivider, MenuItem, MenuList, RowFlex } from '@cherrystudio/ui'
import { NutstoreIcon } from '@renderer/components/Icons/NutstoreIcons'
import Scrollbar from '@renderer/components/Scrollbar'
import { useTheme } from '@renderer/context/ThemeProvider'
import ImportMenuOptions from '@renderer/pages/settings/DataSettings/ImportMenuSettings'
import { FileText, FolderCog, FolderInput, FolderOpen } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  SettingContainer,
  settingsSubmenuDividerClassName,
  settingsSubmenuItemClassName,
  settingsSubmenuListClassName,
  settingsSubmenuScrollClassName,
  settingsSubmenuSectionTitleClassName
} from '..'
import BasicDataSettings from './BasicDataSettings'
import ExportMenuOptions from './ExportMenuSettings'
import LocalBackupSettings from './LocalBackupSettings'
import MarkdownExportSettings from './MarkdownExportSettings'
import NutstoreSettings from './NutstoreSettings'
import S3Settings from './S3Settings'
import WebDavSettings from './WebDavSettings'

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
    }
  ]

  return (
    <RowFlex className="flex-1">
      <Scrollbar className={`${settingsSubmenuScrollClassName} [&_.iconfont]:text-current [&_.iconfont]:leading-4`}>
        <MenuList className={settingsSubmenuListClassName}>
          {menuItems.map((item, index) =>
            item.isDivider ? (
              <div key={item.key}>
                {index > 0 && <MenuDivider className={settingsSubmenuDividerClassName} />}
                <div
                  className={
                    index === 0
                      ? 'px-2.5 pt-1 pb-2 font-medium text-foreground-muted text-xs'
                      : settingsSubmenuSectionTitleClassName
                  }>
                  {item.text || ''}
                </div>
              </div>
            ) : (
              <MenuItem
                key={item.key}
                label={item.title || ''}
                active={menu === item.key}
                onClick={() => setMenu(item.key)}
                icon={item.icon}
                className={settingsSubmenuItemClassName}
              />
            )
          )}
        </MenuList>
      </Scrollbar>
      <SettingContainer theme={theme} style={{ display: 'flex', flex: 1, height: '100%' }}>
        {menu === 'data' && <BasicDataSettings />}
        {menu === 'webdav' && <WebDavSettings />}
        {menu === 'nutstore' && <NutstoreSettings />}
        {menu === 's3' && <S3Settings />}
        {menu === 'import_settings' && <ImportMenuOptions />}
        {menu === 'export_menu' && <ExportMenuOptions />}
        {menu === 'markdown_export' && <MarkdownExportSettings />}
        {menu === 'local_backup' && <LocalBackupSettings />}
      </SettingContainer>
    </RowFlex>
  )
}

export default DataSettings
