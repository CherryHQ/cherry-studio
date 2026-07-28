import { MenuDivider, MenuItem, MenuList, PageHeader, RowFlex } from '@cherrystudio/ui'
import { JoplinIcon, SiyuanIcon } from '@renderer/components/icons/SvgIcon'
import Scrollbar from '@renderer/components/Scrollbar'
import { SettingsContentColumn } from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import ImportMenuOptions from '@renderer/pages/settings/DataSettings/ImportMenuSettings'
import {
  settingsSubmenuDividerClassName,
  settingsSubmenuItemClassName,
  settingsSubmenuItemLabelClassName,
  settingsSubmenuListClassName,
  settingsSubmenuScrollClassName,
  settingsSubmenuSectionTitleClassName
} from '@renderer/pages/settings/settingsStyles'
import { BookOpen, FileText, FolderCog, FolderInput, Import } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import BasicDataSettings from './BasicDataSettings'
import ExportMenuOptions from './ExportMenuSettings'
import JoplinSettings from './JoplinSettings'
import MarkdownExportSettings from './MarkdownExportSettings'
import NotionSettings from './NotionSettings'
import ObsidianSettings from './ObsidianSettings'
import SiyuanSettings from './SiyuanSettings'
import YuqueSettings from './YuqueSettings'

const DataSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [menu, setMenu] = useState<string>('data')

  const menuItems = [
    { key: 'data', title: t('settings.data.data.title'), icon: <FolderCog size={16} /> },
    { key: 'divider_1', isDivider: true, text: t('settings.data.divider.import_settings') },
    {
      key: 'import_settings',
      title: t('settings.data.import_settings.title'),
      icon: <Import size={16} />
    },
    { key: 'divider_2', isDivider: true, text: t('settings.data.divider.export_settings') },
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
    { key: 'divider_note_export', isDivider: true, text: t('settings.data.divider.note_export') },
    { key: 'notion', title: t('settings.data.notion.title'), icon: <i className="iconfont icon-notion" /> },
    { key: 'yuque', title: t('settings.data.yuque.title'), icon: <BookOpen size={16} /> },
    { key: 'joplin', title: t('settings.data.joplin.title'), icon: <JoplinIcon /> },
    { key: 'obsidian', title: t('settings.data.obsidian.title'), icon: <i className="iconfont icon-obsidian" /> },
    { key: 'siyuan', title: t('settings.data.siyuan.title'), icon: <SiyuanIcon /> }
  ]

  return (
    <RowFlex className="flex-1">
      <div
        className={`flex flex-col ${settingsSubmenuScrollClassName} [&_.iconfont]:text-current [&_.iconfont]:leading-4`}>
        <PageHeader title={t('settings.data.title')} />
        <Scrollbar className="min-h-0 flex-1">
          <MenuList className={settingsSubmenuListClassName}>
            {menuItems.map((item, index) =>
              item.isDivider ? (
                <div key={item.key}>
                  {index > 0 && <MenuDivider className={settingsSubmenuDividerClassName} />}
                  <div className={settingsSubmenuSectionTitleClassName}>{item.text || ''}</div>
                </div>
              ) : (
                <MenuItem
                  key={item.key}
                  label={item.title || ''}
                  active={menu === item.key}
                  onClick={() => setMenu(item.key)}
                  icon={item.icon}
                  className={settingsSubmenuItemClassName}
                  labelClassName={settingsSubmenuItemLabelClassName}
                />
              )
            )}
          </MenuList>
        </Scrollbar>
      </div>
      <SettingsContentColumn theme={theme}>
        {menu === 'data' && <BasicDataSettings />}
        {menu === 'import_settings' && <ImportMenuOptions />}
        {menu === 'export_menu' && <ExportMenuOptions />}
        {menu === 'markdown_export' && <MarkdownExportSettings />}
        {menu === 'notion' && <NotionSettings />}
        {menu === 'yuque' && <YuqueSettings />}
        {menu === 'joplin' && <JoplinSettings />}
        {menu === 'obsidian' && <ObsidianSettings />}
        {menu === 'siyuan' && <SiyuanSettings />}
      </SettingsContentColumn>
    </RowFlex>
  )
}

export default DataSettings
