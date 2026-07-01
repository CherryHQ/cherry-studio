import { MenuDivider, MenuItem, MenuList } from '@cherrystudio/ui'
import { useWindowFrame } from '@renderer/components/chat/shell/WindowFrameContext'
import { McpLogo } from '@renderer/components/Icons'
import { SubWindowTitle } from '@renderer/components/layout/SubWindowTitle'
import { TITLE_BAR_HEIGHT_CLASS } from '@renderer/components/layout/titleBar'
import Scrollbar from '@renderer/components/Scrollbar'
import WindowControls from '@renderer/components/WindowControls'
import { isMac } from '@renderer/utils/platform'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import useWindowFocus from '@renderer/hooks/useWindowFocus'
import { cn } from '@renderer/utils/style'
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import {
  Blocks,
  CalendarClock,
  Cloud,
  Command,
  FileCode,
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
  const isWindowFocused = useWindowFocus()
  const isGlassActive = isMacTransparentWindow && isWindowFocused
  const { mode, chrome } = useWindowFrame()
  const isDetached = mode === 'window'

  const isActive = (path: string) => pathname === path || pathname.startsWith(`${path}/`)
  const go = (path: string) => navigate({ to: path })

  const titleBar = (
    <div
      className={cn(
        'flex shrink-0 items-center [-webkit-app-region:drag]',
        TITLE_BAR_HEIGHT_CLASS,
        isMac ? 'pl-[max(env(titlebar-area-x),1.25rem)]' : 'pl-5',
        isMacTransparentWindow ? 'bg-transparent' : 'bg-sidebar'
      )}>
      <SubWindowTitle className="min-w-0 flex-1" />
      {chrome?.titleTrailing && (
        <div className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">{chrome.titleTrailing}</div>
      )}
      <WindowControls />
    </div>
  )

  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col',
        isDetached ? (isGlassActive ? 'bg-sidebar-translucent' : 'bg-sidebar') : 'bg-background'
      )}>
      {/* Detached windows get a full-width draggable title strip so the whole top
       * edge (over both the nav column and the content card) can move the window. */}
      {isDetached && titleBar}
      <div className="flex min-h-0 flex-1 flex-row">
        <div
          className={cn(
            'flex min-h-0 w-(--settings-width) min-w-(--settings-width) flex-col',
            !isDetached && 'border-border border-r-[0.5px]'
          )}>
          <Scrollbar className="min-h-0 flex-1 select-none">
            <MenuList className={cn(settingsSubmenuListClassName, 'pt-2')}>
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
            </MenuList>
          </Scrollbar>
        </div>
        <div className={cn('flex h-full min-h-0 min-w-0 flex-1', isDetached && 'pr-1.5 pb-1.5')}>
          <div
            className={cn(
              'flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background text-foreground',
              isDetached && 'rounded-[16px] border-[0.5px]',
              isDetached && (isGlassActive ? 'border-frame-border-translucent' : 'border-frame-border')
            )}>
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsPage
