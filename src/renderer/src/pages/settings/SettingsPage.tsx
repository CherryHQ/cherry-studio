import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import ModelSettings from '@renderer/pages/settings/ModelSettings/ModelSettings'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { updateTabRoute } from '@renderer/store/tabs'
import {
  Cloud,
  Command,
  Globe,
  HardDrive,
  Info,
  MonitorCog,
  Package,
  Rocket,
  Settings2,
  SquareTerminal,
  TextCursorInput,
  Zap
} from 'lucide-react'
// 导入useAppSelector
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import AboutSettings from './AboutSettings'
import DataSettings from './DataSettings/DataSettings'
import DisplaySettings from './DisplaySettings/DisplaySettings'
import GeneralSettings from './GeneralSettings'
import MCPSettings from './MCPSettings'
import { McpSettingsNavbar } from './MCPSettings/McpSettingsNavbar'
import ProvidersList from './ProviderSettings'
import QuickAssistantSettings from './QuickAssistantSettings'
import QuickPhraseSettings from './QuickPhraseSettings'
import SelectionAssistantSettings from './SelectionAssistantSettings/SelectionAssistantSettings'
import ShortcutSettings from './ShortcutSettings'
import WebSearchSettings from './WebSearchSettings'

const SettingsPage: FC = () => {
  const { pathname } = useLocation()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const { activeTabId } = useAppSelector((state) => state.tabs)

  const isRoute = (path: string): string => (pathname.startsWith(path) ? 'active' : '')

  const navigateToSettings = (route: string) => {
    // Update the current tab's route
    if (activeTabId) {
      dispatch(updateTabRoute({ tabId: activeTabId, route }))
    }
    // Navigate using React Router
    navigate(route)
  }

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('settings.title')}</NavbarCenter>
        {pathname.includes('/settings/mcp') && <McpSettingsNavbar />}
      </Navbar>
      <ContentContainer id="content-container">
        <SettingMenus>
          <MenuItem className={isRoute('/settings/provider')} onClick={() => navigateToSettings('/settings/provider')}>
            <Cloud size={18} />
            {t('settings.provider.title')}
          </MenuItem>
          <MenuItem className={isRoute('/settings/model')} onClick={() => navigateToSettings('/settings/model')}>
            <Package size={18} />
            {t('settings.model')}
          </MenuItem>
          <MenuItem
            className={isRoute('/settings/web-search')}
            onClick={() => navigateToSettings('/settings/web-search')}>
            <Globe size={18} />
            {t('settings.websearch.title')}
          </MenuItem>
          <MenuItem className={isRoute('/settings/mcp')} onClick={() => navigateToSettings('/settings/mcp')}>
            <SquareTerminal size={18} />
            {t('settings.mcp.title')}
          </MenuItem>
          <MenuItem className={isRoute('/settings/general')} onClick={() => navigateToSettings('/settings/general')}>
            <Settings2 size={18} />
            {t('settings.general')}
          </MenuItem>
          <MenuItem className={isRoute('/settings/display')} onClick={() => navigateToSettings('/settings/display')}>
            <MonitorCog size={18} />
            {t('settings.display.title')}
          </MenuItem>
          <MenuItem className={isRoute('/settings/shortcut')} onClick={() => navigateToSettings('/settings/shortcut')}>
            <Command size={18} />
            {t('settings.shortcuts.title')}
          </MenuItem>
          <MenuItem
            className={isRoute('/settings/quickAssistant')}
            onClick={() => navigateToSettings('/settings/quickAssistant')}>
            <Rocket size={18} />
            {t('settings.quickAssistant.title')}
          </MenuItem>
          <MenuItem
            className={isRoute('/settings/selectionAssistant')}
            onClick={() => navigateToSettings('/settings/selectionAssistant')}>
            <TextCursorInput size={18} />
            {t('selection.name')}
          </MenuItem>
          <MenuItem
            className={isRoute('/settings/quickPhrase')}
            onClick={() => navigateToSettings('/settings/quickPhrase')}>
            <Zap size={18} />
            {t('settings.quickPhrase.title')}
          </MenuItem>
          <MenuItem className={isRoute('/settings/data')} onClick={() => navigateToSettings('/settings/data')}>
            <HardDrive size={18} />
            {t('settings.data.title')}
          </MenuItem>
          <MenuItem className={isRoute('/settings/about')} onClick={() => navigateToSettings('/settings/about')}>
            <Info size={18} />
            {t('settings.about')}
          </MenuItem>
        </SettingMenus>
        <SettingContent>
          <Routes>
            <Route path="/settings/provider" element={<ProvidersList />} />
            <Route path="/settings/model" element={<ModelSettings />} />
            <Route path="/settings/web-search" element={<WebSearchSettings />} />
            <Route path="/settings/mcp/*" element={<MCPSettings />} />
            <Route path="/settings/general" element={<GeneralSettings />} />
            <Route path="/settings/display" element={<DisplaySettings />} />
            <Route path="/settings/shortcut" element={<ShortcutSettings />} />
            <Route path="/settings/quickAssistant" element={<QuickAssistantSettings />} />
            <Route path="/settings/selectionAssistant" element={<SelectionAssistantSettings />} />
            <Route path="/settings/data" element={<DataSettings />} />
            <Route path="/settings/about" element={<AboutSettings />} />
            <Route path="/settings/quickPhrase" element={<QuickPhraseSettings />} />
            {/* Default route - redirect to provider when no sub-route is specified */}
            <Route path="/settings" element={<Navigate to="/settings/provider" replace />} />
          </Routes>
        </SettingContent>
      </ContentContainer>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
`

const SettingMenus = styled.ul`
  display: flex;
  flex-direction: column;
  min-width: var(--settings-width);
  border-right: 0.5px solid var(--color-border);
  padding: 10px;
  user-select: none;
`

const MenuItem = styled.li`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  width: 100%;
  cursor: pointer;
  border-radius: var(--list-item-border-radius);
  font-weight: 500;
  transition: all 0.2s ease-in-out;
  border: 0.5px solid transparent;
  margin-bottom: 5px;
  .anticon {
    font-size: 16px;
    opacity: 0.8;
  }
  .iconfont {
    font-size: 18px;
    line-height: 18px;
    opacity: 0.7;
    margin-left: -1px;
  }
  &:hover {
    background: var(--color-background-soft);
  }
  &.active {
    background: var(--color-background-soft);
    border: 0.5px solid var(--color-border);
  }
`

const SettingContent = styled.div`
  display: flex;
  height: 100%;
  flex: 1;
  border-right: 0.5px solid var(--color-border);
`

export default SettingsPage
