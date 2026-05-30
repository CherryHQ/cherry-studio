import { YuqueOutlined } from '@ant-design/icons'
import { MenuItem, MenuList, PageHeader, RowFlex } from '@cherrystudio/ui'
import { JoplinIcon, SiyuanIcon } from '@renderer/components/Icons'
import Scrollbar from '@renderer/components/Scrollbar'
import { useTheme } from '@renderer/context/ThemeProvider'
import type { FC, ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  SettingContainer,
  settingsSubmenuItemClassName,
  settingsSubmenuItemLabelClassName,
  settingsSubmenuListClassName,
  settingsSubmenuScrollClassName
} from '..'
import JoplinSettings from './JoplinSettings'
import NotionSettings from './NotionSettings'
import ObsidianSettings from './ObsidianSettings'
import SiyuanSettings from './SiyuanSettings'
import YuqueSettings from './YuqueSettings'

type IntegrationMenuKey = 'notion' | 'yuque' | 'joplin' | 'obsidian' | 'siyuan'

type IntegrationMenuItem = {
  key: IntegrationMenuKey
  title: string
  icon: ReactNode
}

const IntegrationSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [menu, setMenu] = useState<IntegrationMenuKey>('notion')

  const menuItems: IntegrationMenuItem[] = [
    { key: 'notion', title: t('settings.data.notion.title'), icon: <i className="iconfont icon-notion" /> },
    { key: 'yuque', title: t('settings.data.yuque.title'), icon: <YuqueOutlined style={{ fontSize: 16 }} /> },
    { key: 'joplin', title: t('settings.data.joplin.title'), icon: <JoplinIcon /> },
    { key: 'obsidian', title: t('settings.data.obsidian.title'), icon: <i className="iconfont icon-obsidian" /> },
    { key: 'siyuan', title: t('settings.data.siyuan.title'), icon: <SiyuanIcon /> }
  ]

  return (
    <RowFlex className="flex-1">
      <div className={`flex flex-col ${settingsSubmenuScrollClassName}`}>
        <PageHeader title={t('settings.integrations.title')} />
        <Scrollbar className="min-h-0 flex-1 [&_.iconfont]:text-current [&_.iconfont]:leading-4">
          <MenuList className={settingsSubmenuListClassName}>
            {menuItems.map((item) => (
              <MenuItem
                key={item.key}
                label={item.title}
                active={menu === item.key}
                onClick={() => setMenu(item.key)}
                icon={item.icon}
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
              />
            ))}
          </MenuList>
        </Scrollbar>
      </div>
      <SettingContainer theme={theme} style={{ display: 'flex', flex: 1, height: '100%' }}>
        {menu === 'notion' && <NotionSettings />}
        {menu === 'yuque' && <YuqueSettings />}
        {menu === 'joplin' && <JoplinSettings />}
        {menu === 'obsidian' && <ObsidianSettings />}
        {menu === 'siyuan' && <SiyuanSettings />}
      </SettingContainer>
    </RowFlex>
  )
}

export default IntegrationSettings
