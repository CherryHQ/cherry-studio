import { MenuDivider, MenuItem, MenuList } from '@cherrystudio/ui'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { McpLogo } from '@renderer/components/Icons'
import Scrollbar from '@renderer/components/Scrollbar'
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import {
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('settings.title')}</NavbarCenter>
      </Navbar>
      <div
        id="content-container"
        className="flex h-[calc(100vh-var(--navbar-height))] min-h-0 flex-1 flex-row bg-background-subtle py-px">
        <Scrollbar className="flex min-h-0 min-w-(--settings-width) select-none flex-col border-border border-r-[0.5px] p-2.5">
          <MenuList>
            <MenuItem
              icon={<Cloud size={18} />}
              label={t('settings.provider.title')}
              active={isActive('/settings/provider')}
              onClick={() => go('/settings/provider')}
            />
            <MenuItem
              icon={<Package size={18} />}
              label={t('settings.model')}
              active={isActive('/settings/model')}
              onClick={() => go('/settings/model')}
            />
            <MenuDivider />
            <MenuItem
              icon={<Settings2 size={18} />}
              label={t('settings.general.label')}
              active={isActive('/settings/general')}
              onClick={() => go('/settings/general')}
            />
            <MenuItem
              icon={<MonitorCog size={18} />}
              label={t('settings.display.title')}
              active={isActive('/settings/display')}
              onClick={() => go('/settings/display')}
            />
            <MenuItem
              icon={<HardDrive size={18} />}
              label={t('settings.data.title')}
              active={isActive('/settings/data')}
              onClick={() => go('/settings/data')}
            />
            <MenuDivider />
            <MenuItem
              icon={<McpLogo width={18} height={18} style={{ opacity: 0.8 }} />}
              label={t('settings.mcp.title')}
              active={isActive('/settings/mcp')}
              onClick={() => go('/settings/mcp')}
            />
            <MenuItem
              icon={<Sparkles size={18} />}
              label={t('settings.skills.title')}
              active={isActive('/settings/skills')}
              onClick={() => go('/settings/skills')}
            />
            <MenuItem
              icon={<Search size={18} />}
              label={t('settings.tool.websearch.title')}
              active={isActive('/settings/websearch')}
              onClick={() => go('/settings/websearch')}
            />
            <MenuItem
              icon={<Server size={18} />}
              label={t('apiServer.title')}
              active={isActive('/settings/api-server')}
              onClick={() => go('/settings/api-server')}
            />
            <MenuItem
              icon={<Radio size={18} />}
              label={t('settings.channels.title')}
              active={isActive('/settings/channels')}
              onClick={() => go('/settings/channels')}
            />
            <MenuItem
              icon={<CalendarClock size={18} />}
              label={t('settings.scheduledTasks.title')}
              active={isActive('/settings/scheduled-tasks')}
              onClick={() => go('/settings/scheduled-tasks')}
            />
            <MenuItem
              icon={<FileCode size={18} />}
              label={t('settings.tool.preprocess.title')}
              active={isActive('/settings/docprocess')}
              onClick={() => go('/settings/docprocess')}
            />
            <MenuItem
              icon={<Zap size={18} />}
              label={t('settings.quickPhrase.title')}
              active={isActive('/settings/quickphrase')}
              onClick={() => go('/settings/quickphrase')}
            />
            <MenuItem
              icon={<Command size={18} />}
              label={t('settings.shortcuts.title')}
              active={isActive('/settings/shortcut')}
              onClick={() => go('/settings/shortcut')}
            />
            <MenuDivider />
            <MenuItem
              icon={<PictureInPicture2 size={18} />}
              label={t('settings.quickAssistant.title')}
              active={isActive('/settings/quickAssistant')}
              onClick={() => go('/settings/quickAssistant')}
            />
            <MenuItem
              icon={<TextCursorInput size={18} />}
              label={t('selection.name')}
              active={isActive('/settings/selectionAssistant')}
              onClick={() => go('/settings/selectionAssistant')}
            />
            <MenuDivider />
            <MenuItem
              icon={<Info size={18} />}
              label={t('settings.about.label')}
              active={isActive('/settings/about')}
              onClick={() => go('/settings/about')}
            />
          </MenuList>
        </Scrollbar>
        <div className="flex h-full min-h-0 flex-1 p-2.5">
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-xs border border-border/40 bg-card text-card-foreground shadow-xs">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsPage
