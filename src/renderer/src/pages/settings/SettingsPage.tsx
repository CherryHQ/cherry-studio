import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { McpLogo } from '@renderer/components/Icons'
import Scrollbar from '@renderer/components/Scrollbar'
import ModelSettings from '@renderer/pages/settings/ModelSettings/ModelSettings'
import { Divider as AntDivider, Input } from 'antd'
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
  Search,
  Server,
  Settings2,
  TextCursorInput,
  Zap
} from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import styled from 'styled-components'

import AboutSettings from './AboutSettings'
import DataSettings from './DataSettings/DataSettings'
import DisplaySettings from './DisplaySettings/DisplaySettings'
import DocProcessSettings from './DocProcessSettings'
import GeneralSettings from './GeneralSettings'
import MCPSettings from './MCPSettings'
import MemorySettings from './MemorySettings'
import { ProviderList } from './ProviderSettings'
import QuickAssistantSettings from './QuickAssistantSettings'
import QuickPhraseSettings from './QuickPhraseSettings'
import SelectionAssistantSettings from './SelectionAssistantSettings/SelectionAssistantSettings'
import { SettingsSearchProvider, useSettingsSearch } from './SettingsSearchContext'
import { useHighlightSettings } from './SettingsSearchHighlightHook'
import ShortcutSettings from './ShortcutSettings'
import { ApiServerSettings } from './ToolSettings/ApiServerSettings'
import WebSearchSettings from './WebSearchSettings'

// Menu item definition
interface MenuItemDef {
  path: string
  icon: ReactNode
  labelKey: string
}

// Define all menu items with their routes
const MENU_ITEMS: MenuItemDef[] = [
  { path: '/settings/provider', icon: <Cloud size={18} />, labelKey: 'settings.provider.title' },
  { path: '/settings/model', icon: <Package size={18} />, labelKey: 'settings.model' }
]

const MENU_ITEMS_GROUP2: MenuItemDef[] = [
  { path: '/settings/general', icon: <Settings2 size={18} />, labelKey: 'settings.general.label' },
  { path: '/settings/display', icon: <MonitorCog size={18} />, labelKey: 'settings.display.title' },
  { path: '/settings/data', icon: <HardDrive size={18} />, labelKey: 'settings.data.title' }
]

const MENU_ITEMS_GROUP3: MenuItemDef[] = [
  {
    path: '/settings/mcp',
    icon: <McpLogo width={18} height={18} style={{ opacity: 0.8 }} />,
    labelKey: 'settings.mcp.title'
  },
  { path: '/settings/websearch', icon: <Search size={18} />, labelKey: 'settings.tool.websearch.title' },
  { path: '/settings/memory', icon: <Brain size={18} />, labelKey: 'memory.title' },
  { path: '/settings/api-server', icon: <Server size={18} />, labelKey: 'apiServer.title' },
  { path: '/settings/docprocess', icon: <FileCode size={18} />, labelKey: 'settings.tool.preprocess.title' },
  { path: '/settings/quickphrase', icon: <Zap size={18} />, labelKey: 'settings.quickPhrase.title' },
  { path: '/settings/shortcut', icon: <Command size={18} />, labelKey: 'settings.shortcuts.title' }
]

const MENU_ITEMS_GROUP4: MenuItemDef[] = [
  {
    path: '/settings/quickAssistant',
    icon: <PictureInPicture2 size={18} />,
    labelKey: 'settings.quickAssistant.title'
  },
  { path: '/settings/selectionAssistant', icon: <TextCursorInput size={18} />, labelKey: 'selection.name' }
]

const MENU_ITEMS_GROUP5: MenuItemDef[] = [
  { path: '/settings/about', icon: <Info size={18} />, labelKey: 'settings.about.label' }
]

const SettingsSearch = () => {
  const { t } = useTranslation()
  const { searchQuery, setSearchQuery } = useSettingsSearch()

  return (
    <SearchContainer>
      <Input
        placeholder={t('chat.assistant.search.placeholder')}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        style={{ borderRadius: 'var(--list-item-border-radius)', height: 35 }}
        suffix={<Search size={14} color="var(--color-text-2)" />}
        allowClear
      />
    </SearchContainer>
  )
}

const SettingsPageContent: FC = () => {
  const { pathname } = useLocation()
  const { t } = useTranslation()
  const { isSearchActive, matchingRoutes } = useSettingsSearch()

  // Use the new highlight hook
  useHighlightSettings()

  const isRoute = (path: string): string => (pathname.startsWith(path) ? 'active' : '')

  // Filter menu items based on search
  const filterItems = (items: MenuItemDef[]) => {
    if (!isSearchActive) return items
    return items.filter((item) => matchingRoutes.has(item.path))
  }

  const renderMenuGroup = (items: MenuItemDef[]) => {
    const filtered = filterItems(items)
    return filtered.map((item) => (
      <MenuItemLink key={item.path} to={item.path}>
        <MenuItem className={isRoute(item.path)}>
          {item.icon}
          {t(item.labelKey)}
        </MenuItem>
      </MenuItemLink>
    ))
  }

  // Check if any items in a group have matches
  const hasMatchesInGroup = (items: MenuItemDef[]) => {
    if (!isSearchActive) return true
    return items.some((item) => matchingRoutes.has(item.path))
  }

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('settings.title')}</NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container">
        <SettingMenus>
          <SettingsSearch />
          {renderMenuGroup(MENU_ITEMS)}
          {hasMatchesInGroup(MENU_ITEMS_GROUP2) && hasMatchesInGroup(MENU_ITEMS) && <Divider />}
          {renderMenuGroup(MENU_ITEMS_GROUP2)}
          {hasMatchesInGroup(MENU_ITEMS_GROUP3) &&
            (hasMatchesInGroup(MENU_ITEMS) || hasMatchesInGroup(MENU_ITEMS_GROUP2)) && <Divider />}
          {renderMenuGroup(MENU_ITEMS_GROUP3)}
          {hasMatchesInGroup(MENU_ITEMS_GROUP4) && <Divider />}
          {renderMenuGroup(MENU_ITEMS_GROUP4)}
          {hasMatchesInGroup(MENU_ITEMS_GROUP5) && <Divider />}
          {renderMenuGroup(MENU_ITEMS_GROUP5)}
        </SettingMenus>
        <SettingContent>
          <Routes>
            <Route path="provider" element={<ProviderList />} />
            <Route path="model" element={<ModelSettings />} />
            <Route path="websearch/*" element={<WebSearchSettings />} />
            <Route path="api-server" element={<ApiServerSettings />} />
            <Route path="docprocess" element={<DocProcessSettings />} />
            <Route path="quickphrase" element={<QuickPhraseSettings />} />
            <Route path="mcp/*" element={<MCPSettings />} />
            <Route path="memory" element={<MemorySettings />} />
            <Route path="general/*" element={<GeneralSettings />} />
            <Route path="display" element={<DisplaySettings />} />
            <Route path="shortcut" element={<ShortcutSettings />} />
            <Route path="quickAssistant" element={<QuickAssistantSettings />} />
            <Route path="selectionAssistant" element={<SelectionAssistantSettings />} />
            <Route path="data" element={<DataSettings />} />
            <Route path="about" element={<AboutSettings />} />
          </Routes>
        </SettingContent>
      </ContentContainer>
    </Container>
  )
}

const SettingsPage: FC = () => {
  return (
    <SettingsSearchProvider>
      <SettingsPageContent />
    </SettingsSearchProvider>
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
  height: calc(100vh - var(--navbar-height));
  padding: 1px 0;
  overflow: hidden;
`

const SettingMenus = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  min-width: var(--settings-width);
  border-right: 0.5px solid var(--color-border);
  padding: 10px;
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
  overflow: hidden;
  min-width: 0;
`

const Divider = styled(AntDivider)`
  margin: 3px 0;
`

const SearchContainer = styled.div`
  position: relative;
  border-bottom: 0.5px solid var(--color-border);
  padding-bottom: 10px;
  margin-bottom: 5px;
`

export default SettingsPage
