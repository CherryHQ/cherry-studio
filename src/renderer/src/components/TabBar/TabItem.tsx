import { CloseOutlined, PushpinOutlined } from '@ant-design/icons'
import EmojiAvatar from '@renderer/components/Avatar/EmojiAvatar'
import MinAppIcon from '@renderer/components/Icons/MinAppIcon'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAppDispatch } from '@renderer/store'
import { closeOtherTabs, closeTabsToTheRight, pinTab, unpinTab } from '@renderer/store/tabs'
import { Tab } from '@renderer/store/tabs'
import { isEmoji } from '@renderer/utils'
import { Dropdown, MenuProps } from 'antd'
import { FileSearch, Folder, Languages, LayoutGrid, MessageSquare, Palette, Settings, Sparkle } from 'lucide-react'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface TabItemProps {
  tab: Tab
  isActive: boolean
  onClick: () => void
  onClose: (e: React.MouseEvent) => void
}

const TabItem: React.FC<TabItemProps> = ({ tab, isActive, onClick, onClose }) => {
  const dispatch = useAppDispatch()
  const { theme } = useTheme()
  const { t } = useTranslation()

  // Get icon for the tab
  const tabIcon = useMemo(() => {
    if (tab.type === 'minapp' && tab.minapp) {
      return <MinAppIcon size={16} app={tab.minapp} style={{ borderRadius: 4 }} />
    }

    // Use provided icon if it's a string (emoji)
    if (tab.icon && typeof tab.icon === 'string') {
      if (isEmoji(tab.icon)) {
        return (
          <EmojiAvatar size={16} fontSize={12}>
            {tab.icon}
          </EmojiAvatar>
        )
      }
    }

    // Default icons based on route
    const iconMap: Record<string, React.ReactNode> = {
      '/': <MessageSquare size={14} />,
      '/agents': <Sparkle size={14} />,
      '/paintings': <Palette size={14} />,
      '/translate': <Languages size={14} />,
      '/files': <Folder size={14} />,
      '/knowledge': <FileSearch size={14} />,
      '/apps': <LayoutGrid size={14} />,
      '/settings': <Settings size={14} />
    }

    const routePrefix = tab.route?.split('/')[1]
    const icon = iconMap[tab.route || ''] || iconMap[`/${routePrefix}`] || <MessageSquare size={14} />

    return icon
  }, [tab])

  // Context menu items
  const menuItems: MenuProps['items'] = [
    {
      key: 'close',
      label: t('common.close'),
      onClick: (e) => {
        e.domEvent.stopPropagation()
        onClose(e.domEvent as any)
      },
      disabled: !tab.canClose
    },
    {
      key: 'closeOthers',
      label: t('tabs.closeOthers'),
      onClick: (e) => {
        e.domEvent.stopPropagation()
        dispatch(closeOtherTabs(tab.id))
      }
    },
    {
      key: 'closeToRight',
      label: t('tabs.closeToRight'),
      onClick: (e) => {
        e.domEvent.stopPropagation()
        dispatch(closeTabsToTheRight(tab.id))
      }
    },
    { type: 'divider' },
    {
      key: 'pin',
      label: tab.isPinned ? t('tabs.unpin') : t('tabs.pin'),
      icon: <PushpinOutlined />,
      onClick: (e) => {
        e.domEvent.stopPropagation()
        if (tab.isPinned) {
          dispatch(unpinTab(tab.id))
        } else {
          dispatch(pinTab(tab.id))
        }
      }
    }
  ]

  const handleMiddleClick = (e: React.MouseEvent) => {
    if (e.button === 1 && tab.canClose) {
      e.preventDefault()
      onClose(e)
    }
  }

  return (
    <Dropdown menu={{ items: menuItems }} trigger={['contextMenu']}>
      <TabContainer
        data-tab-id={tab.id}
        theme={theme}
        isActive={isActive}
        isPinned={tab.isPinned}
        onClick={onClick}
        onMouseDown={handleMiddleClick}
        onAuxClick={handleMiddleClick}>
        <TabContent>
          <TabIcon>{tabIcon}</TabIcon>
          {!tab.isPinned && <TabTitle>{tab.title}</TabTitle>}
        </TabContent>
        {!tab.isPinned && tab.canClose && (
          <CloseButton theme={theme} onClick={onClose} onMouseDown={(e) => e.stopPropagation()}>
            <CloseOutlined style={{ fontSize: 10 }} />
          </CloseButton>
        )}
      </TabContainer>
    </Dropdown>
  )
}

const TabContainer = styled.div<{ theme: string; isActive: boolean; isPinned: boolean }>`
  display: flex;
  align-items: center;
  height: 30px;
  padding: 0 ${({ isPinned }) => (isPinned ? '8px' : '12px')};
  min-width: ${({ isPinned }) => (isPinned ? '40px' : '120px')};
  max-width: ${({ isPinned }) => (isPinned ? '40px' : '200px')};
  border-radius: 6px 6px 0 0;
  background: ${({ theme, isActive }) => {
    if (isActive) {
      return theme === 'dark' ? 'var(--color-background-soft)' : 'var(--color-white)'
    }
    return theme === 'dark' ? 'rgba(255, 255, 255, 0.02)' : 'rgba(0, 0, 0, 0.02)'
  }};
  border: 1px solid ${({ isActive }) => (isActive ? 'var(--color-border)' : 'transparent')};
  border-bottom: ${({ isActive }) => (isActive ? 'none' : '1px solid transparent')};
  margin-bottom: ${({ isActive }) => (isActive ? '-1px' : '0')};
  cursor: pointer;
  user-select: none;
  transition: all 0.2s ease;
  position: relative;

  &:hover {
    background: ${({ theme, isActive }) => {
      if (isActive) return
      return theme === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'
    }};
  }

  &::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: ${({ isActive }) => (isActive ? '1px' : '0')};
    background: ${({ theme }) => (theme === 'dark' ? 'var(--color-background-soft)' : 'var(--color-white)')};
  }
`

const TabContent = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  overflow: hidden;
`

const TabIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-2);
  flex-shrink: 0;
`

const TabTitle = styled.span`
  font-size: 12px;
  color: var(--color-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
`

const CloseButton = styled.button<{ theme: string }>`
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-3);
  transition: all 0.2s ease;
  margin-left: 4px;
  flex-shrink: 0;

  &:hover {
    background: ${({ theme }) => (theme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)')};
    color: var(--color-text-1);
  }

  &:active {
    transform: scale(0.9);
  }
`

export default TabItem
