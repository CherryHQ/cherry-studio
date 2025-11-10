import { isMac } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { modelGenerating } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { getSidebarIconLabel, getThemeModeLabel } from '@renderer/i18n/label'
import { ThemeMode } from '@renderer/types'
import { Tooltip } from 'antd'
import { GlobalOutlined } from '@ant-design/icons'
import {
  Brain,
  Cloud,
  Code,
  Command,
  FileCode,
  FileSearch,
  Folder,
  Hammer,
  HardDrive,
  Home,
  Info,
  Languages,
  LayoutGrid,
  Monitor,
  MonitorCog,
  Moon,
  NotebookPen,
  Package,
  Palette,
  PictureInPicture2,
  Plus,
  Server,
  Settings2,
  Sparkle,
  Sun,
  TextCursorInput,
  Zap
} from 'lucide-react'
import { FC, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

const SideMenu: FC = () => {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { theme, settedTheme, toggleTheme } = useTheme()
  const { sidebarIcons, defaultPaintingProvider } = useSettings()
  const { hideMinappPopup } = useMinappPopup()
  const { t } = useTranslation()

  const isHomeActive = pathname === '/' || pathname === ''

  const handleHomeClick = useCallback(async () => {
    await modelGenerating()
    navigate('/')
  }, [navigate])

  const handleAddTab = useCallback(async () => {
    hideMinappPopup()
    await modelGenerating()
    navigate('/launchpad')
  }, [navigate, hideMinappPopup])

  const iconMap = useMemo(
    () => ({
      assistants: <Home size={18} />,
      store: <Sparkle size={18} />,
      paintings: <Palette size={18} />,
      translate: <Languages size={18} />,
      minapp: <LayoutGrid size={18} />,
      knowledge: <FileSearch size={18} />,
      files: <Folder size={18} />,
      notes: <NotebookPen size={18} />,
      code_tools: <Code size={18} />
    }),
    []
  )

  const pathMap = useMemo(
    () => ({
      assistants: '/',
      store: '/store',
      paintings: `/paintings/${defaultPaintingProvider}`,
      translate: '/translate',
      minapp: '/apps',
      knowledge: '/knowledge',
      files: '/files',
      code_tools: '/code',
      notes: '/notes'
    }),
    [defaultPaintingProvider]
  )

  const isRoute = (path: string): boolean => pathname === path
  const isRoutes = (path: string): boolean => pathname.startsWith(path)

  const settingsMenuItems = useMemo(
    () => [
      { path: '/settings/provider', iconType: 'cloud', label: t('settings.provider.title') },
      { path: '/settings/model', iconType: 'package', label: t('settings.model') },
      { path: '/settings/general', iconType: 'settings2', label: t('settings.general.label') },
      { path: '/settings/display', iconType: 'monitorCog', label: t('settings.display.title') },
      { path: '/settings/data', iconType: 'hardDrive', label: t('settings.data.title') },
      { path: '/settings/mcp', iconType: 'hammer', label: t('settings.mcp.title') },
      { path: '/settings/notes', iconType: 'notebookPen', label: t('notes.settings.title') },
      { path: '/settings/websearch', iconType: 'globalOutlined', label: t('settings.tool.websearch.title') },
      { path: '/settings/memory', iconType: 'brain', label: t('memory.title') },
      { path: '/settings/api-server', iconType: 'server', label: t('apiServer.title') },
      { path: '/settings/docprocess', iconType: 'fileCode', label: t('settings.tool.preprocess.title') },
      { path: '/settings/quickphrase', iconType: 'zap', label: t('settings.quickPhrase.title') },
      { path: '/settings/shortcut', iconType: 'command', label: t('settings.shortcuts.title') },
      { path: '/settings/quickAssistant', iconType: 'pictureInPicture2', label: t('settings.quickAssistant.title') },
      { path: '/settings/selectionAssistant', iconType: 'textCursorInput', label: t('selection.name') },
      { path: '/settings/about', iconType: 'info', label: t('settings.about.label') },
    ],
    [t]
  )

  const getSettingsIcon = (iconType: string) => {
    switch (iconType) {
      case 'cloud':
        return <Cloud size={18} />
      case 'package':
        return <Package size={18} />
      case 'settings2':
        return <Settings2 size={18} />
      case 'monitorCog':
        return <MonitorCog size={18} />
      case 'hardDrive':
        return <HardDrive size={18} />
      case 'hammer':
        return <Hammer size={18} />
      case 'notebookPen':
        return <NotebookPen size={18} />
      case 'globalOutlined':
        return <GlobalOutlined style={{ fontSize: 18 }} />
      case 'brain':
        return <Brain size={18} />
      case 'server':
        return <Server size={18} />
      case 'fileCode':
        return <FileCode size={18} />
      case 'zap':
        return <Zap size={18} />
      case 'command':
        return <Command size={18} />
      case 'pictureInPicture2':
        return <PictureInPicture2 size={18} />
      case 'textCursorInput':
        return <TextCursorInput size={18} />
      case 'info':
        return <Info size={18} />
      default:
        return null
    }
  }

  return (
    <Container id="app-side-menu">
      <TopSection>
        <NewChatButton onClick={handleAddTab} theme={theme}>
          <Plus size={18} />
          <span>New</span>
        </NewChatButton>
        <HomeButton onClick={handleHomeClick} $active={isHomeActive} theme={theme}>
          <Home size={18} />
          <span>Home</span>
        </HomeButton>
      </TopSection>

      <ScrollableSection>
        <NavigationSection>
          {sidebarIcons.visible
            .filter((icon) => !['paintings', 'translate', 'minapp', 'code_tools'].includes(icon))
            .map((icon) => {
              const path = pathMap[icon]
              const isActive = path === '/' ? isRoute(path) : isRoutes(path)

              return (
                <Tooltip key={icon} title={getSidebarIconLabel(icon)} placement="right" mouseEnterDelay={0.8}>
                  <NavItem
                    onClick={async () => {
                      hideMinappPopup()
                      await modelGenerating()
                      navigate(path)
                    }}
                    $active={isActive}
                    theme={theme}>
                    {iconMap[icon]}
                    <span>{getSidebarIconLabel(icon)}</span>
                  </NavItem>
                </Tooltip>
              )
            })}
        </NavigationSection>

        <SettingsSection>
          <SettingsSectionTitle>Settings</SettingsSectionTitle>
          {settingsMenuItems.map((item) => {
            const isActive = pathname.startsWith(item.path)
            return (
              <NavItem
                key={item.path}
                onClick={async () => {
                  hideMinappPopup()
                  await modelGenerating()
                  navigate(item.path)
                }}
                $active={isActive}
                theme={theme}>
                {getSettingsIcon(item.iconType)}
                <span>{item.label}</span>
              </NavItem>
            )
          })}
        </SettingsSection>

        {/* Future conversations/chats will be added here */}
        <EmptyState>
          <EmptyText>No conversations yet</EmptyText>
          <EmptySubtext>Start a new chat to see your conversations here</EmptySubtext>
        </EmptyState>
      </ScrollableSection>

      <BottomSection>
        <Tooltip title={t('settings.theme.title') + ': ' + getThemeModeLabel(settedTheme)} placement="right">
          <BottomButton onClick={toggleTheme} theme={theme}>
            {settedTheme === ThemeMode.dark ? (
              <Moon size={18} />
            ) : settedTheme === ThemeMode.light ? (
              <Sun size={18} />
            ) : (
              <Monitor size={18} />
            )}
          </BottomButton>
        </Tooltip>
      </BottomSection>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  width: var(--side-menu-width);
  min-width: var(--side-menu-width);
  height: ${isMac ? 'calc(100vh - env(titlebar-area-height))' : '100vh'};
  background-color: var(--color-background);
  border-right: 0.5px solid var(--color-border);
  -webkit-app-region: drag;
  margin-top: ${isMac ? 'env(titlebar-area-height)' : 0};
  position: relative;
`

const TopSection = styled.div`
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  -webkit-app-region: none;
  border-bottom: 0.5px solid var(--color-border);
`

const NewChatButton = styled.button<{ theme: string }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 0.5px solid var(--color-border);
  background-color: ${({ theme }) => (theme === 'dark' ? 'var(--color-background-soft)' : 'var(--color-white)')};
  color: var(--color-text);
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s ease;
  -webkit-app-region: none;

  &:hover {
    background-color: ${({ theme }) => (theme === 'dark' ? 'var(--color-black)' : 'var(--color-background-soft)')};
    border-color: var(--color-primary);
  }

  &:active {
    transform: scale(0.98);
  }

  svg {
    color: var(--color-primary);
  }
`

const HomeButton = styled.button<{ $active: boolean; theme: string }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 0.5px solid ${({ $active }) => ($active ? 'var(--color-primary)' : 'transparent')};
  background-color: ${({ $active, theme }) =>
    $active
      ? theme === 'dark'
        ? 'var(--color-black)'
        : 'var(--color-white)'
      : 'transparent'};
  color: ${({ $active }) => ($active ? 'var(--color-primary)' : 'var(--color-text)')};
  cursor: pointer;
  font-size: 14px;
  font-weight: ${({ $active }) => ($active ? '500' : '400')};
  transition: all 0.2s ease;
  -webkit-app-region: none;

  &:hover {
    background-color: ${({ theme }) => (theme === 'dark' ? 'var(--color-black)' : 'var(--color-background-soft)')};
    border-color: ${({ $active }) => ($active ? 'var(--color-primary)' : 'var(--color-border)')};
  }

  &:active {
    transform: scale(0.98);
  }

  svg {
    color: ${({ $active }) => ($active ? 'var(--color-primary)' : 'var(--color-text-secondary)')};
  }
`

const ScrollableSection = styled.div`
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px;
  -webkit-app-region: none;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border-radius: 3px;

    &:hover {
      background: var(--color-text-secondary);
    }
  }
`

const NavigationSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 16px;
`

const NavItem = styled.button<{ $active: boolean; theme: string }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 0.5px solid ${({ $active }) => ($active ? 'var(--color-primary)' : 'transparent')};
  background-color: ${({ $active, theme }) =>
    $active
      ? theme === 'dark'
        ? 'var(--color-black)'
        : 'var(--color-white)'
      : 'transparent'};
  color: ${({ $active }) => ($active ? 'var(--color-primary)' : 'var(--color-text)')};
  cursor: pointer;
  font-size: 14px;
  font-weight: ${({ $active }) => ($active ? '500' : '400')};
  transition: all 0.2s ease;
  -webkit-app-region: none;
  text-align: left;
  width: 100%;

  &:hover {
    background-color: ${({ theme }) => (theme === 'dark' ? 'var(--color-black)' : 'var(--color-background-soft)')};
    border-color: ${({ $active }) => ($active ? 'var(--color-primary)' : 'var(--color-border)')};
  }

  &:active {
    transform: scale(0.98);
  }

  svg {
    color: ${({ $active }) => ($active ? 'var(--color-primary)' : 'var(--color-text-secondary)')};
    flex-shrink: 0;
  }

  span {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
`

const EmptyText = styled.div`
  font-size: 14px;
  color: var(--color-text);
  margin-bottom: 8px;
  font-weight: 500;
`

const EmptySubtext = styled.div`
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.5;
`

const BottomSection = styled.div`
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 0.5px solid var(--color-border);
  -webkit-app-region: none;
`

const BottomButton = styled.button<{ $active?: boolean; theme: string }>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 10px;
  border-radius: 8px;
  border: 0.5px solid ${({ $active }) => ($active ? 'var(--color-primary)' : 'transparent')};
  background-color: ${({ $active, theme }) =>
    $active
      ? theme === 'dark'
        ? 'var(--color-black)'
        : 'var(--color-white)'
      : 'transparent'};
  color: ${({ $active }) => ($active ? 'var(--color-primary)' : 'var(--color-text)')};
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-app-region: none;

  &:hover {
    background-color: ${({ theme }) => (theme === 'dark' ? 'var(--color-black)' : 'var(--color-background-soft)')};
    border-color: ${({ $active }) => ($active ? 'var(--color-primary)' : 'var(--color-border)')};
  }

  &:active {
    transform: scale(0.98);
  }

  svg {
    color: ${({ $active }) => ($active ? 'var(--color-primary)' : 'var(--color-text-secondary)')};
  }
`

const SettingsSection = styled.div`
  margin-top: 16px;
  margin-bottom: 16px;
  padding-top: 16px;
  border-top: 0.5px solid var(--color-border);
  -webkit-app-region: none;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const SettingsSectionTitle = styled.div`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-secondary);
  padding: 8px 12px 4px;
  margin-bottom: 4px;
`

export default SideMenu

