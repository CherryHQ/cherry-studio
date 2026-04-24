import { MenuDivider, MenuItem, MenuList } from '@cherrystudio/ui'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { McpLogo } from '@renderer/components/Icons'
import Scrollbar from '@renderer/components/Scrollbar'
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import {
  Blocks,
  CalendarClock,
  Cloud,
  Command,
  FileCode,
  HardDrive,
  Info,
  MonitorCog,
  Package,
  PictureInPicture2,
  Radio,
  Search,
  Server,
  Settings2,
  Sparkles,
  TextCursorInput,
  Zap
} from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

const SettingsPage: FC = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { pathname } = location
  const { t } = useTranslation()

  const isActive = (path: string) => pathname.startsWith(path)
  const go = (path: string) => navigate({ to: path })
  const menuItemClassName =
    'h-8 rounded-lg border-transparent px-2.5 font-semibold text-foreground/85 text-sm hover:!bg-muted data-[active=true]:!border-transparent data-[active=true]:!bg-muted data-[active=true]:!text-foreground [&_svg]:size-4 [&_svg]:text-foreground/70'
  const sectionTitleClassName = 'px-2.5 pt-1.5 pb-1 font-medium text-foreground-muted text-xs first:pt-0'
  const sectionDividerClassName = 'my-1 bg-transparent'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('settings.title')}</NavbarCenter>
      </Navbar>
      <div
        id="content-container"
        className="flex h-[calc(100vh-var(--navbar-height))] min-h-0 flex-1 flex-row bg-background">
        <div className="flex min-h-0 w-[200px] min-w-[200px] bg-background">
          <Scrollbar className="flex min-h-0 flex-1 select-none flex-col bg-background p-2.5">
            <MenuList className="gap-0.5">
              <div className={sectionTitleClassName}>{t('settings.menuGroups.integrations')}</div>
              <MenuItem
                className={menuItemClassName}
                icon={<Cloud />}
                label={t('settings.provider.title')}
                active={isActive('/settings/provider')}
                onClick={() => go('/settings/provider')}
              />
              <MenuItem
                className={menuItemClassName}
                icon={<Package />}
                label={t('settings.model')}
                active={isActive('/settings/model')}
                onClick={() => go('/settings/model')}
              />
              <MenuItem
                className={menuItemClassName}
                icon={<Server />}
                label={t('apiServer.title')}
                active={isActive('/settings/api-server')}
                onClick={() => go('/settings/api-server')}
              />
              <MenuItem
                className={menuItemClassName}
                icon={<Radio />}
                label={t('settings.channels.title')}
                active={isActive('/settings/channels')}
                onClick={() => go('/settings/channels')}
              />
              <MenuDivider className={sectionDividerClassName} />
              <div className={sectionTitleClassName}>{t('settings.menuGroups.services')}</div>
              <MenuItem
                className={menuItemClassName}
                icon={<McpLogo width={16} height={16} className="text-foreground/70" />}
                label={t('settings.mcp.title')}
                active={isActive('/settings/mcp')}
                onClick={() => go('/settings/mcp')}
              />
              <MenuItem
                className={menuItemClassName}
                icon={<Blocks />}
                label={t('settings.plugins.title')}
                active={isActive('/settings/plugins')}
                onClick={() => go('/settings/plugins')}
              />
              <MenuItem
                className={menuItemClassName}
                icon={<Search />}
                label={t('settings.tool.websearch.title')}
                active={isActive('/settings/websearch')}
                onClick={() => go('/settings/websearch')}
              />
              <MenuItem
                className={menuItemClassName}
                icon={<FileCode />}
                label={t('settings.tool.preprocess.title')}
                active={isActive('/settings/docprocess')}
                onClick={() => go('/settings/docprocess')}
              />
              <MenuItem
                className={menuItemClassName}
                icon={<CalendarClock />}
                label={t('settings.scheduledTasks.title')}
                active={isActive('/settings/scheduled-tasks')}
                onClick={() => go('/settings/scheduled-tasks')}
              />
              <MenuDivider className={sectionDividerClassName} />
              <div className={sectionTitleClassName}>{t('settings.menuGroups.appSettings')}</div>
              <MenuItem
                className={menuItemClassName}
                icon={<Settings2 />}
                label={t('settings.general.label')}
                active={isActive('/settings/general')}
                onClick={() => go('/settings/general')}
              />
              <MenuItem
                className={menuItemClassName}
                icon={<MonitorCog />}
                label={t('settings.display.title')}
                active={isActive('/settings/display')}
                onClick={() => go('/settings/display')}
              />
              <MenuItem
                className={menuItemClassName}
                icon={<HardDrive />}
                label={t('settings.data.title')}
                active={isActive('/settings/data')}
                onClick={() => go('/settings/data')}
              />
              <MenuDivider className={sectionDividerClassName} />
              <div className={sectionTitleClassName}>{t('settings.menuGroups.productivity')}</div>
              <MenuItem
                className={menuItemClassName}
                icon={<Sparkles />}
                label={t('settings.skills.title')}
                active={isActive('/settings/skills')}
                onClick={() => go('/settings/skills')}
              />
              <MenuItem
                className={menuItemClassName}
                icon={<Zap />}
                label={t('settings.quickPhrase.title')}
                active={isActive('/settings/quickphrase')}
                onClick={() => go('/settings/quickphrase')}
              />
              <MenuItem
                className={menuItemClassName}
                icon={<Command />}
                label={t('settings.shortcuts.title')}
                active={isActive('/settings/shortcut')}
                onClick={() => go('/settings/shortcut')}
              />
              <MenuItem
                className={menuItemClassName}
                icon={<PictureInPicture2 />}
                label={t('settings.quickAssistant.title')}
                active={isActive('/settings/quickAssistant')}
                onClick={() => go('/settings/quickAssistant')}
              />
              <MenuItem
                className={menuItemClassName}
                icon={<TextCursorInput />}
                label={t('selection.name')}
                active={isActive('/settings/selectionAssistant')}
                onClick={() => go('/settings/selectionAssistant')}
              />
              <MenuDivider className={sectionDividerClassName} />
              <div className={sectionTitleClassName}>{t('settings.menuGroups.system')}</div>
              <MenuItem
                className={menuItemClassName}
                icon={<Info />}
                label={t('settings.about.label')}
                active={isActive('/settings/about')}
                onClick={() => go('/settings/about')}
              />
            </MenuList>
          </Scrollbar>
        </div>
        <div className="flex h-full min-h-0 flex-1 p-2.5 pl-0">
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border/40 bg-card bg-muted/10 text-card-foreground shadow-xs">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsPage
