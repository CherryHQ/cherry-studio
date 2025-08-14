import { GlobalOutlined } from '@ant-design/icons'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import { useNavbarPosition } from '@renderer/hooks/useSettings'
import ModelSettings from '@renderer/pages/settings/ModelSettings/ModelSettings'
import { AppRoutes, SettingsRoute, SettingsRoutes } from '@renderer/types'
import { Divider as AntDivider } from 'antd'
import {
  Brain,
  Cloud,
  Command,
  FileCode,
  HardDrive,
  Info,
  MonitorCog,
  Package,
  PictureInPicture2,
  Settings2,
  SquareTerminal,
  TextCursorInput,
  Zap
} from 'lucide-react'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import styled from 'styled-components'

import AboutSettings from './AboutSettings'
import DataSettings from './DataSettings/DataSettings'
import DisplaySettings from './DisplaySettings/DisplaySettings'
import GeneralSettings from './GeneralSettings'
import MCPSettings from './MCPSettings'
import MemorySettings from './MemorySettings'
import PreprocessSettings from './PreprocessSettings'
import ProvidersList from './ProviderSettings'
import QuickAssistantSettings from './QuickAssistantSettings'
import QuickPhraseSettings from './QuickPhraseSettings'
import SelectionAssistantSettings from './SelectionAssistantSettings/SelectionAssistantSettings'
import ShortcutSettings from './ShortcutSettings'
import WebSearchSettings from './WebSearchSettings'

// remove "/settings/"
const PATH_START_INDEX = AppRoutes.SETTINGS.length + 1

const SettingsPage: FC = () => {
  const { pathname } = useLocation()
  const { t } = useTranslation()
  const { isTopNavbar } = useNavbarPosition()

  const isRoute = (path: string): string => (pathname.startsWith(path) ? 'active' : '')

  const noRadiusPaths = ['/settings/provider', '/settings/data'] satisfies SettingsRoute[]
  const shouldRadius = isTopNavbar && !noRadiusPaths.some((path) => pathname.startsWith(path))

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('settings.title')}</NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container">
        <SettingMenusContainer>
          <SettingMenus style={{ borderRadius: shouldRadius ? 8 : 0 }}>
            <MenuItemLink to={SettingsRoutes.PROVIDER}>
              <MenuItem className={isRoute(SettingsRoutes.PROVIDER)}>
                <Cloud size={18} />
                {t('settings.provider.title')}
              </MenuItem>
            </MenuItemLink>
            <MenuItemLink to={SettingsRoutes.MODEL}>
              <MenuItem className={isRoute(SettingsRoutes.MODEL)}>
                <Package size={18} />
                {t('settings.model')}
              </MenuItem>
            </MenuItemLink>
            <Divider />
            <MenuItemLink to={SettingsRoutes.GENERAL}>
              <MenuItem className={isRoute(SettingsRoutes.GENERAL)}>
                <Settings2 size={18} />
                {t('settings.general.label')}
              </MenuItem>
            </MenuItemLink>
            <MenuItemLink to={SettingsRoutes.DISPLAY}>
              <MenuItem className={isRoute(SettingsRoutes.DISPLAY)}>
                <MonitorCog size={18} />
                {t('settings.display.title')}
              </MenuItem>
            </MenuItemLink>
            <MenuItemLink to={SettingsRoutes.DATA}>
              <MenuItem className={isRoute(SettingsRoutes.DATA)}>
                <HardDrive size={18} />
                {t('settings.data.title')}
              </MenuItem>
            </MenuItemLink>
            <Divider />
            <MenuItemLink to={SettingsRoutes.MCP}>
              <MenuItem className={isRoute(SettingsRoutes.MCP)}>
                <SquareTerminal size={18} />
                {t('settings.mcp.title')}
              </MenuItem>
            </MenuItemLink>
            <MenuItemLink to={SettingsRoutes.WEBSEARCH}>
              <MenuItem className={isRoute(SettingsRoutes.WEBSEARCH)}>
                <GlobalOutlined style={{ fontSize: 18 }} />
                {t('settings.tool.websearch.title')}
              </MenuItem>
            </MenuItemLink>
            <MenuItemLink to={SettingsRoutes.MEMORY}>
              <MenuItem className={isRoute(SettingsRoutes.MEMORY)}>
                <Brain size={18} />
                {t('memory.title')}
              </MenuItem>
            </MenuItemLink>
            <MenuItemLink to={SettingsRoutes.PREPROCESS}>
              <MenuItem className={isRoute(SettingsRoutes.PREPROCESS)}>
                <FileCode size={18} />
                {t('settings.tool.preprocess.title')}
              </MenuItem>
            </MenuItemLink>
            <MenuItemLink to={SettingsRoutes.QUICK_PHRASE}>
              <MenuItem className={isRoute(SettingsRoutes.QUICK_PHRASE)}>
                <Zap size={18} />
                {t('settings.quickPhrase.title')}
              </MenuItem>
            </MenuItemLink>
            <MenuItemLink to={SettingsRoutes.SHORTCUT}>
              <MenuItem className={isRoute(SettingsRoutes.SHORTCUT)}>
                <Command size={18} />
                {t('settings.shortcuts.title')}
              </MenuItem>
            </MenuItemLink>
            <Divider />
            <MenuItemLink to={SettingsRoutes.QUICK_ASSISTANT}>
              <MenuItem className={isRoute(SettingsRoutes.QUICK_ASSISTANT)}>
                <PictureInPicture2 size={18} />
                {t('settings.quickAssistant.title')}
              </MenuItem>
            </MenuItemLink>
            <MenuItemLink to={SettingsRoutes.SELECTION_ASSISTANT}>
              <MenuItem className={isRoute(SettingsRoutes.SELECTION_ASSISTANT)}>
                <TextCursorInput size={18} />
                {t('selection.name')}
              </MenuItem>
            </MenuItemLink>
            <Divider />
            <MenuItemLink to={SettingsRoutes.ABOUT}>
              <MenuItem className={isRoute(SettingsRoutes.ABOUT)}>
                <Info size={18} />
                {t('settings.about.label')}
              </MenuItem>
            </MenuItemLink>
          </SettingMenus>
        </SettingMenusContainer>

        <SettingContent>
          <Routes>
            <Route path={SettingsRoutes.PROVIDER.slice(PATH_START_INDEX)} element={<ProvidersList />} />
            <Route path={SettingsRoutes.MODEL.slice(PATH_START_INDEX)} element={<ModelSettings />} />
            <Route path={SettingsRoutes.WEBSEARCH.slice(PATH_START_INDEX)} element={<WebSearchSettings />} />
            <Route path={SettingsRoutes.PREPROCESS.slice(PATH_START_INDEX)} element={<PreprocessSettings />} />
            <Route path={SettingsRoutes.QUICK_PHRASE.slice(PATH_START_INDEX)} element={<QuickPhraseSettings />} />
            <Route path={SettingsRoutes.MCP_ROOT.slice(PATH_START_INDEX)} element={<MCPSettings />} />
            <Route path={SettingsRoutes.MEMORY.slice(PATH_START_INDEX)} element={<MemorySettings />} />
            <Route path={SettingsRoutes.GENERAL_ROOT.slice(PATH_START_INDEX)} element={<GeneralSettings />} />
            <Route path={SettingsRoutes.DISPLAY.slice(PATH_START_INDEX)} element={<DisplaySettings />} />
            <Route path={SettingsRoutes.SHORTCUT.slice(PATH_START_INDEX)} element={<ShortcutSettings />} />
            <Route path={SettingsRoutes.QUICK_ASSISTANT.slice(PATH_START_INDEX)} element={<QuickAssistantSettings />} />
            <Route
              path={SettingsRoutes.SELECTION_ASSISTANT.slice(PATH_START_INDEX)}
              element={<SelectionAssistantSettings />}
            />
            <Route path={SettingsRoutes.DATA.slice(PATH_START_INDEX)} element={<DataSettings />} />
            <Route path={SettingsRoutes.ABOUT.slice(PATH_START_INDEX)} element={<AboutSettings />} />
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
  padding: 1px 0;
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  background-color: var(--color-background-soft);
  height: 100%;
`

const SettingMenusContainer = styled.div`
  display: flex;
  flex-direction: column;
  min-width: var(--settings-width);
  background-color: var(--color-background-soft);
`

const SettingMenus = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  flex: 1;
  padding: 10px;
  border-right: 0.5px solid var(--color-border);
  background-color: var(--color-background);
  user-select: none;
  gap: 5px;
`

const MenuItemLink = styled(Link)`
  text-decoration: none;
  color: var(--color-text-1);
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
  .anticon {
    font-size: 16px;
    opacity: 0.8;
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
`

const Divider = styled(AntDivider)`
  margin: 3px 0;
`

export default SettingsPage
