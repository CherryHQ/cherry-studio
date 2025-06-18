import { PlusOutlined } from '@ant-design/icons'
import { isMac } from '@renderer/config/constant'
import { useFullscreen } from '@renderer/hooks/useFullscreen'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import type { Tab } from '@renderer/store/tabs'
import { addTab, removeTab, setActiveTab } from '@renderer/store/tabs'
import {
  FileSearch,
  Folder,
  Home,
  Languages,
  LayoutGrid,
  Palette,
  Settings,
  Sparkle,
  SquareTerminal,
  X
} from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

interface TabsContainerProps {
  children: React.ReactNode
}

const getTabIcon = (tabId: string): React.ReactNode | undefined => {
  switch (tabId) {
    case 'home':
      return <Home size={14} />
    case 'agents':
      return <Sparkle size={14} />
    case 'translate':
      return <Languages size={14} />
    case 'paintings':
      return <Palette size={14} />
    case 'apps':
      return <LayoutGrid size={14} />
    case 'knowledge':
      return <FileSearch size={14} />
    case 'mcp':
      return <SquareTerminal size={14} />
    case 'files':
      return <Folder size={14} />
    case 'settings':
      return <Settings size={14} />
    default:
      return null
  }
}

const TabsContainer: React.FC<TabsContainerProps> = ({ children }) => {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const tabs = useAppSelector((state) => state.tabs.tabs)
  const activeTabId = useAppSelector((state) => state.tabs.activeTabId)
  const isFullscreen = useFullscreen()

  const getTabId = (path: string): string => {
    if (path === '/') return 'home'
    const segments = path.split('/')
    return segments[1] // 获取第一个路径段作为 id
  }

  const shouldCreateTab = (path: string) => {
    if (path === '/') return false
    return !tabs.some((tab) => tab.id === getTabId(path))
  }

  useEffect(() => {
    const tabId = getTabId(location.pathname)
    const currentTab = tabs.find((tab) => tab.id === tabId)

    if (!currentTab && shouldCreateTab(location.pathname)) {
      dispatch(
        addTab({
          id: tabId,
          path: location.pathname
        })
      )
    } else if (currentTab) {
      dispatch(setActiveTab(currentTab.id))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, location.pathname])

  const closeTab = (tabId: string) => {
    const tabToClose = tabs.find((tab) => tab.id === tabId)
    if (!tabToClose) return

    if (tabs.length === 1) return

    if (tabId === activeTabId) {
      const remainingTabs = tabs.filter((tab) => tab.id !== tabId)
      const lastTab = remainingTabs[remainingTabs.length - 1]
      navigate(lastTab.path)
    }

    dispatch(removeTab(tabId))
  }

  const handleAddTab = () => {
    navigate('/launchpad')
  }

  return (
    <Container>
      <TabsBar $isFullscreen={isFullscreen}>
        {tabs.map((tab) => (
          <Tab key={tab.id} active={tab.id === activeTabId} onClick={() => navigate(tab.path)}>
            <TabHeader>
              {tab.id && <TabIcon>{getTabIcon(tab.id)}</TabIcon>}
              <TabTitle>{t(`title.${tab.id}`)}</TabTitle>
            </TabHeader>
            {tab.id !== 'home' && (
              <CloseButton
                className="close-button"
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(tab.id)
                }}>
                <X size={12} />
              </CloseButton>
            )}
          </Tab>
        ))}
        <AddTabButton onClick={handleAddTab}>
          <PlusOutlined />
        </AddTabButton>
      </TabsBar>
      <TabContent>{children}</TabContent>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`

const TabsBar = styled.div<{ $isFullscreen: boolean }>`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
  padding-left: ${({ $isFullscreen }) => (!$isFullscreen && isMac ? '80px' : '8px')};
  -webkit-app-region: drag;
  height: var(--navbar-height);
`

const Tab = styled.div<{ active?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  background: ${(props) => (props.active ? 'var(--color-background)' : 'transparent')};
  border-radius: 8px;
  cursor: pointer;
  user-select: none;
  -webkit-app-region: none;
  min-width: 100px;
  transition: background 0.2s;
  .close-button {
    opacity: 0;
    transition: opacity 0.2s;
    margin-right: -2px;
  }

  &:hover {
    background: ${(props) => (props.active ? 'var(--color-background)' : 'var(--color-background-soft)')};
    .close-button {
      opacity: 1;
    }
  }
`

const TabHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`

const TabIcon = styled.span`
  display: flex;
  align-items: center;
  margin-right: 6px;
  color: var(--color-text-2);
`

const TabTitle = styled.span`
  color: var(--color-text);
  font-size: 13px;
  margin-right: 8px;
  display: flex;
  align-items: center;
`

const CloseButton = styled.span`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
`

const AddTabButton = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  cursor: pointer;
  color: var(--color-text);
  -webkit-app-region: none;

  &:hover {
    background: var(--color-background-soft);
    border-radius: 8px;
  }
`

const TabContent = styled.div`
  display: flex;
  flex: 1;
  overflow: hidden;
  width: calc(100vw - 12px);
  margin: 6px;
  margin-top: 0;
  border-radius: 8px;
  overflow: hidden;
`

export default TabsContainer
