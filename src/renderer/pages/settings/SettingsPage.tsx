import { MenuDivider, MenuItem, MenuList, PageHeader } from '@cherrystudio/ui'
import { GatewayIcon } from '@renderer/components/icons/GatewayIcon'
import { McpLogo } from '@renderer/components/icons/SvgIcon'
import Scrollbar from '@renderer/components/Scrollbar'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import {
  settingsSubmenuDividerClassName,
  settingsSubmenuItemClassName,
  settingsSubmenuItemLabelClassName,
  settingsSubmenuListClassName,
  settingsSubmenuSectionTitleClassName
} from '@renderer/pages/settings/settingsStyles'
import { cn } from '@renderer/utils/style'
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import {
  Bell,
  CalendarClock,
  Cloud,
  Command,
  FileBox,
  FileCode,
  HardDrive,
  Info,
  Package,
  Palette,
  PictureInPicture2,
  Radio,
  ScanText,
  Search,
  Settings2,
  Terminal,
  TextCursorInput
} from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

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
      data-ui="settings.view"
      className={cn(
        'flex min-h-0 flex-1 flex-col',
        isMacTransparentWindow ? 'bg-transparent' : 'bg-white dark:bg-background'
      )}>
      <div className="flex min-h-0 flex-1 flex-row">
        <div
          data-ui="settings.navigation"
          className="flex min-h-0 w-(--settings-width) min-w-(--settings-width) flex-col border-border border-r-[0.5px]">
          <PageHeader title={t('title.settings')} className="mb-1" />
          <Scrollbar className="min-h-0 flex-1 select-none">
            <MenuList className={settingsSubmenuListClassName}>
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
                icon={<FileBox />}
                label={t('settings.dependencies.localModels.title')}
                active={isActive('/settings/local-models')}
                onClick={() => go('/settings/local-models')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<GatewayIcon />}
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
                label={t('settings.tool.file_processing.features.document_to_markdown.title')}
                active={isActive('/settings/file-processing')}
                onClick={() => go('/settings/file-processing')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<ScanText />}
                label={t('settings.tool.file_processing.features.image_to_text.title')}
                active={isActive('/settings/ocr')}
                onClick={() => go('/settings/ocr')}
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
                icon={<HardDrive />}
                label={t('settings.data.title')}
                active={isActive('/settings/data')}
                onClick={() => go('/settings/data')}
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
                icon={<Settings2 />}
                label={t('settings.system.title')}
                active={isActive('/settings/system')}
                onClick={() => go('/settings/system')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<Terminal />}
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
          <div data-ui="settings.content" className="flex min-h-0 min-w-0 flex-1 overflow-hidden text-foreground">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsPage
