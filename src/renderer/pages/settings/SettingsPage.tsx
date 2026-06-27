import { MenuDivider, MenuItem, MenuList, PageHeader } from '@cherrystudio/ui'
import { McpLogo } from '@renderer/components/Icons'
import Scrollbar from '@renderer/components/Scrollbar'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import { cn } from '@renderer/utils/style'
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import {
  Bell,
  CalendarClock,
  Cloud,
  Command,
  FileCode,
  HardDrive,
  Info,
  Package,
  PackageCheck,
  Palette,
  PictureInPicture2,
  Radio,
  Search,
  Server,
  Settings2,
  SquareTerminal,
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
        <div className="flex min-h-0 w-(--settings-width) min-w-(--settings-width) flex-col border-border border-r-[0.5px]">
          <PageHeader title={t('title.settings')} />
          <Scrollbar className="min-h-0 flex-1 select-none">
            <MenuList className={settingsSubmenuListClassName}>
              <div className={settingsSubmenuSectionTitleClassName}>{t('settings.menuGroups.models')}</div>
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
                label={t('apiGateway.title')}
                active={isActive('/settings/api-gateway')}
                onClick={() => go('/settings/api-gateway')}
              />
              <MenuDivider className={settingsSubmenuDividerClassName} />
              <div className={settingsSubmenuSectionTitleClassName}>{t('settings.menuGroups.capabilities')}</div>
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
                icon={<SquareTerminal />}
                label={t('chat.settings.code_execution.title')}
                active={isActive('/settings/code-execution')}
                onClick={() => go('/settings/code-execution')}
              />
              <MenuDivider className={settingsSubmenuDividerClassName} />
              <div className={settingsSubmenuSectionTitleClassName}>{t('settings.menuGroups.personal')}</div>
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<Palette />}
                label={t('settings.appearance.title')}
                active={isActive('/settings/appearance')}
                onClick={() => go('/settings/appearance')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<Bell />}
                label={t('settings.notification.title')}
                active={isActive('/settings/notifications')}
                onClick={() => go('/settings/notifications')}
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
                icon={<HardDrive />}
                label={t('settings.data.title')}
                active={isActive('/settings/data')}
                onClick={() => go('/settings/data')}
              />
              <MenuDivider className={settingsSubmenuDividerClassName} />
              <div className={settingsSubmenuSectionTitleClassName}>{t('settings.menuGroups.quickAccess')}</div>
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
              <div className={settingsSubmenuSectionTitleClassName}>{t('settings.menuGroups.automation')}</div>
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
              <MenuDivider className={settingsSubmenuDividerClassName} />
              <div className={settingsSubmenuSectionTitleClassName}>{t('settings.menuGroups.system')}</div>
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<Settings2 />}
                label={t('settings.system.title')}
                active={isActive('/settings/system')}
                onClick={() => go('/settings/system')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<PackageCheck />}
                label={t('settings.dependencies.title')}
                active={isActive('/settings/dependencies')}
                onClick={() => go('/settings/dependencies')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<Info />}
                label={t('settings.about.label')}
                active={isActive('/settings/about')}
                onClick={() => go('/settings/about')}
              />
            </MenuList>
          </Scrollbar>
        </div>
        <div className="flex h-full min-h-0 min-w-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden text-foreground">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsPage
