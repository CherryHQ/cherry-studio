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
import { SETTINGS_NAVIGATION_LABEL_KEYS } from '@renderer/utils/settingsNavigation'
import { cn } from '@renderer/utils/style'
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import {
  Activity,
  Bell,
  CalendarClock,
  Cloud,
  Command,
  Crop,
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
  TextCursorInput,
  ToolCase,
  Zap
} from 'lucide-react'
import type { CSSProperties, FC } from 'react'
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
      style={isMacTransparentWindow ? ({ '--settings-group-background': 'transparent' } as CSSProperties) : undefined}
      data-ui="settings.view"
      className={cn(
        'flex min-h-0 flex-1 flex-col dark:[--settings-group-background:var(--background-subtle)]',
        isMacTransparentWindow ? 'bg-transparent' : 'bg-background'
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
                label={t(SETTINGS_NAVIGATION_LABEL_KEYS['/settings/provider'])}
                active={isActive('/settings/provider')}
                onClick={() => go('/settings/provider')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<Package />}
                label={t(SETTINGS_NAVIGATION_LABEL_KEYS['/settings/model'])}
                active={isActive('/settings/model')}
                onClick={() => go('/settings/model')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<FileBox />}
                label={t(SETTINGS_NAVIGATION_LABEL_KEYS['/settings/local-models'])}
                active={isActive('/settings/local-models')}
                onClick={() => go('/settings/local-models')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<GatewayIcon />}
                label={t(SETTINGS_NAVIGATION_LABEL_KEYS['/settings/api-gateway'])}
                active={isActive('/settings/api-gateway')}
                onClick={() => go('/settings/api-gateway')}
              />
              <MenuDivider className={settingsSubmenuDividerClassName} />
              <div className={settingsSubmenuSectionTitleClassName}>{t('settings.menuGroups.capabilities')}</div>
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<McpLogo width={16} height={16} className="text-foreground" />}
                label={t(SETTINGS_NAVIGATION_LABEL_KEYS['/settings/mcp'])}
                active={isActive('/settings/mcp')}
                onClick={() => go('/settings/mcp')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<ToolCase />}
                label={t(SETTINGS_NAVIGATION_LABEL_KEYS['/settings/skills'])}
                active={isActive('/settings/skills')}
                onClick={() => go('/settings/skills')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<Zap />}
                label={t(SETTINGS_NAVIGATION_LABEL_KEYS['/settings/prompts'])}
                active={isActive('/settings/prompts')}
                onClick={() => go('/settings/prompts')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<Search />}
                label={t(SETTINGS_NAVIGATION_LABEL_KEYS['/settings/websearch'])}
                active={isActive('/settings/websearch')}
                onClick={() => go('/settings/websearch')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<FileCode />}
                label={t(SETTINGS_NAVIGATION_LABEL_KEYS['/settings/file-processing'])}
                active={isActive('/settings/file-processing')}
                onClick={() => go('/settings/file-processing')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<ScanText />}
                label={t(SETTINGS_NAVIGATION_LABEL_KEYS['/settings/ocr'])}
                active={isActive('/settings/ocr')}
                onClick={() => go('/settings/ocr')}
              />
              <MenuDivider className={settingsSubmenuDividerClassName} />
              <div className={settingsSubmenuSectionTitleClassName}>{t('settings.menuGroups.personal')}</div>
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<Settings2 />}
                label={t(SETTINGS_NAVIGATION_LABEL_KEYS['/settings/general'])}
                active={isActive('/settings/general')}
                onClick={() => go('/settings/general')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<Palette />}
                label={t(SETTINGS_NAVIGATION_LABEL_KEYS['/settings/appearance'])}
                active={isActive('/settings/appearance')}
                onClick={() => go('/settings/appearance')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<Bell />}
                label={t(SETTINGS_NAVIGATION_LABEL_KEYS['/settings/notifications'])}
                active={isActive('/settings/notifications')}
                onClick={() => go('/settings/notifications')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<HardDrive />}
                label={t(SETTINGS_NAVIGATION_LABEL_KEYS['/settings/data'])}
                active={isActive('/settings/data')}
                onClick={() => go('/settings/data')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<Activity />}
                label={t(SETTINGS_NAVIGATION_LABEL_KEYS['/settings/usage'])}
                active={isActive('/settings/usage')}
                onClick={() => go('/settings/usage')}
              />
              <MenuDivider className={settingsSubmenuDividerClassName} />
              <div className={settingsSubmenuSectionTitleClassName}>{t('settings.menuGroups.automation')}</div>
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<Radio />}
                label={t(SETTINGS_NAVIGATION_LABEL_KEYS['/settings/channels'])}
                active={isActive('/settings/channels')}
                onClick={() => go('/settings/channels')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<CalendarClock />}
                label={t(SETTINGS_NAVIGATION_LABEL_KEYS['/settings/scheduled-tasks'])}
                active={isActive('/settings/scheduled-tasks')}
                onClick={() => go('/settings/scheduled-tasks')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<Command />}
                label={t(SETTINGS_NAVIGATION_LABEL_KEYS['/settings/shortcut'])}
                active={isActive('/settings/shortcut')}
                onClick={() => go('/settings/shortcut')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<PictureInPicture2 />}
                label={t(SETTINGS_NAVIGATION_LABEL_KEYS['/settings/quick-assistant'])}
                active={isActive('/settings/quick-assistant')}
                onClick={() => go('/settings/quick-assistant')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<TextCursorInput />}
                label={t(SETTINGS_NAVIGATION_LABEL_KEYS['/settings/selection-assistant'])}
                active={isActive('/settings/selection-assistant')}
                onClick={() => go('/settings/selection-assistant')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<Crop />}
                label={t(SETTINGS_NAVIGATION_LABEL_KEYS['/settings/screenshot'])}
                active={isActive('/settings/screenshot')}
                onClick={() => go('/settings/screenshot')}
              />
              <MenuDivider className={settingsSubmenuDividerClassName} />
              <div className={settingsSubmenuSectionTitleClassName}>{t('settings.menuGroups.system')}</div>
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<Terminal />}
                label={t(SETTINGS_NAVIGATION_LABEL_KEYS['/settings/dependencies'])}
                active={isActive('/settings/dependencies')}
                onClick={() => go('/settings/dependencies')}
              />
              <MenuItem
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
                icon={<Info />}
                label={t(SETTINGS_NAVIGATION_LABEL_KEYS['/settings/about'])}
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
