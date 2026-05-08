import { MenuDivider, MenuItem, MenuList } from '@cherrystudio/ui'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { McpLogo } from '@renderer/components/Icons'
import Scrollbar from '@renderer/components/Scrollbar'
import { isDev } from '@renderer/config/constant'
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import {
  CalendarClock,
  Cloud,
  Command,
  FileCode,
  FlaskConical,
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
import styled from 'styled-components'

const SettingsPage: FC = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { pathname } = location
  const { t } = useTranslation()

  const isActive = (path: string) => pathname === path || pathname.startsWith(`${path}/`)
  const go = (path: string) => navigate({ to: path })

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('settings.title')}</NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container">
        <SettingMenus>
          <MenuList>
            <MenuItem
              icon={<Cloud size={18} />}
              label={t('settings.provider.title')}
              active={isActive('/settings/provider')}
              onClick={() => go('/settings/provider')}
            />
            <MenuItem
              icon={<Cloud size={18} />}
              label={`${t('settings.provider.title')} V2`}
              active={isActive('/settings/provider-v2')}
              onClick={() => go('/settings/provider-v2')}
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
              label={t('settings.prompts.title')}
              active={isActive('/settings/prompts')}
              onClick={() => go('/settings/prompts')}
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
            {isDev && (
              <MenuItem
                icon={<FlaskConical size={18} />}
                label={t('settings.componentLab.label')}
                active={isActive('/settings/component-lab')}
                onClick={() => go('/settings/component-lab')}
              />
            )}
          </MenuList>
        </SettingMenus>
        <SettingContent>
          <Outlet />
        </SettingContent>
      </ContentContainer>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  min-height: 0;
  height: calc(100vh - var(--navbar-height));
  padding: 1px 0;
`

const SettingMenus = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  min-width: var(--settings-width);
  min-height: 0;
  border-right: 0.5px solid var(--color-border);
  padding: 10px;
  user-select: none;
`

const SettingContent = styled.div`
  display: flex;
  height: 100%;
  min-height: 0;
  flex: 1;
`

export default SettingsPage
