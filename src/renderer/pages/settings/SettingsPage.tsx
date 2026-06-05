import { MenuDivider, MenuItem, MenuList, PageHeader } from '@cherrystudio/ui'
import { McpLogo } from '@renderer/components/Icons'
import Scrollbar from '@renderer/components/Scrollbar'
import { isDev } from '@renderer/config/constant'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import { cn } from '@renderer/utils/style'
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import {
  Blocks,
  CalendarClock,
  Cloud,
  Command,
  FileCode,
  FlaskConical,
  HardDrive,
  Info,
  Package,
  PackageCheck,
  PictureInPicture2,
  Radio,
  Search,
  Server,
  Settings2,
  TextCursorInput
} from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import {
  settingsSubmenuDividerClassName,
  settingsSubmenuItemClassName,
  settingsSubmenuItemLabelClassName,
  settingsSubmenuListClassName,
  settingsSubmenuSectionTitleClassName
} from '.'

const SettingsPage: FC = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { pathname } = location
  const { t } = useTranslation()
  const isMacTransparentWindow = useMacTransparentWindow()

  const isActive = (path: string) => pathname === path || pathname.startsWith(`${path}/`)
  const go = (path: string) => navigate({ to: path })

  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col',
        isMacTransparentWindow ? 'bg-transparent' : 'bg-white dark:bg-background'
      )}>
      <div className="flex min-h-0 flex-1 flex-row">
        <div
          className={cn(
            'flex min-h-0 w-(--settings-width) min-w-(--settings-width) flex-col',
            isMacTransparentWindow ? 'bg-transparent' : 'bg-white dark:bg-background'
          )}>
          <PageHeader title={t('settings.menuGroups.appSettings')} />
          <Scrollbar className="min-h-0 flex-1 select-none">
            <MenuList className={settingsSubmenuListClassName}>
              <div className={settingsSubmenuSectionTitleClassName}>{t('settings.menuGroups.integrations')}</div>
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<Cloud />}
                label={t('settings.provider.title')}
                active={isActive('/settings/provider')}
                onClick={() => go('/settings/provider')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<Package />}
                label={t('settings.model')}
                active={isActive('/settings/model')}
                onClick={() => go('/settings/model')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<Server />}
                label={t('apiServer.title')}
                active={isActive('/settings/api-server')}
                onClick={() => go('/settings/api-server')}
              />
              <MenuDivider className={settingsSubmenuDividerClassName} />
              <div className={settingsSubmenuSectionTitleClassName}>{t('settings.menuGroups.services')}</div>
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<McpLogo width={16} height={16} className="text-foreground" />}
                label={t('agent.settings.toolsMcp.mcp.tab')}
                active={isActive('/settings/mcp')}
                onClick={() => go('/settings/mcp')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<Search />}
                label={t('settings.tool.websearch.title')}
                active={isActive('/settings/websearch')}
                onClick={() => go('/settings/websearch')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<FileCode />}
                label={t('settings.tool.file_processing.title')}
                active={isActive('/settings/file-processing')}
                onClick={() => go('/settings/file-processing')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<Blocks />}
                label={t('settings.integrations.title')}
                active={isActive('/settings/integrations')}
                onClick={() => go('/settings/integrations')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<PackageCheck />}
                label={t('settings.plugins.title')}
                active={isActive('/settings/plugins')}
                onClick={() => go('/settings/plugins')}
              />
              <MenuDivider className={settingsSubmenuDividerClassName} />
              <div className={settingsSubmenuSectionTitleClassName}>{t('settings.menuGroups.appSettings')}</div>
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<Settings2 />}
                label={t('settings.general.common.title')}
                active={isActive('/settings/general')}
                onClick={() => go('/settings/general')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<HardDrive />}
                label={t('settings.data.title')}
                active={isActive('/settings/data')}
                onClick={() => go('/settings/data')}
              />
              <MenuDivider className={settingsSubmenuDividerClassName} />
              <div className={settingsSubmenuSectionTitleClassName}>{t('settings.menuGroups.productivity')}</div>
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<Radio />}
                label={t('settings.channels.title')}
                active={isActive('/settings/channels')}
                onClick={() => go('/settings/channels')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<CalendarClock />}
                label={t('settings.scheduledTasks.title')}
                active={isActive('/settings/scheduled-tasks')}
                onClick={() => go('/settings/scheduled-tasks')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<Command />}
                label={t('settings.shortcuts.title')}
                active={isActive('/settings/shortcut')}
                onClick={() => go('/settings/shortcut')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<PictureInPicture2 />}
                label={t('settings.quickAssistant.title')}
                active={isActive('/settings/quick-assistant')}
                onClick={() => go('/settings/quick-assistant')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<TextCursorInput />}
                label={t('selection.name')}
                active={isActive('/settings/selection-assistant')}
                onClick={() => go('/settings/selection-assistant')}
              />
              <MenuDivider className={settingsSubmenuDividerClassName} />
              <div className={settingsSubmenuSectionTitleClassName}>{t('settings.menuGroups.system')}</div>
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<Info />}
                label={t('settings.about.label')}
                active={isActive('/settings/about')}
                onClick={() => go('/settings/about')}
              />
              {isDev && (
                <MenuItem
                  className={settingsSubmenuItemClassName}
                  labelClassName={settingsSubmenuItemLabelClassName}
                  icon={<FlaskConical />}
                  label={t('settings.componentLab.label')}
                  active={isActive('/settings/component-lab')}
                  onClick={() => go('/settings/component-lab')}
                />
              )}
            </MenuList>
          </Scrollbar>
        </div>
        <div className="flex h-full min-h-0 min-w-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden border-border/40 border-l bg-white text-foreground dark:bg-background">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsPage
