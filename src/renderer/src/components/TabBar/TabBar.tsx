import { PlusOutlined } from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { closeTab, openTab, switchTab } from '@renderer/store/tabs'
import { Tooltip } from 'antd'
import React, { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import TabItem from './TabItem'

const TabBar: React.FC = () => {
  const dispatch = useAppDispatch()
  const { tabs, tabOrder, activeTabId } = useAppSelector((state) => state.tabs)
  const { hideMinappPopup } = useMinappPopup()
  const { theme } = useTheme()
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to active tab
  useEffect(() => {
    if (activeTabId && scrollContainerRef.current) {
      const activeElement = scrollContainerRef.current.querySelector(`[data-tab-id="${activeTabId}"]`)
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
      }
    }
  }, [activeTabId])

  const handleNewTab = () => {
    hideMinappPopup()
    dispatch(
      openTab({
        type: 'page',
        route: '/',
        title: t('assistants.title'),
        canClose: true,
        isPinned: false
      })
    )
  }

  const handleTabClick = (tabId: string) => {
    hideMinappPopup()
    dispatch(switchTab(tabId))
  }

  const handleTabClose = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation()
    dispatch(closeTab(tabId))
  }

  // Handle empty state - no tabs open
  if (tabs.length === 0) {
    return (
      <Container theme={theme}>
        <EmptyState>
          <NewTabButton onClick={handleNewTab} theme={theme}>
            <PlusOutlined />
            <span>{t('common.new')}</span>
          </NewTabButton>
        </EmptyState>
      </Container>
    )
  }

  return (
    <Container ref={containerRef} theme={theme}>
      <TabsScrollContainer ref={scrollContainerRef}>
        <TabsWrapper>
          {tabOrder.map((tabId) => {
            const tab = tabs.find((t) => t.id === tabId)
            if (!tab) return null

            return (
              <TabItem
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeTabId}
                onClick={() => handleTabClick(tab.id)}
                onClose={(e) => handleTabClose(e, tab.id)}
              />
            )
          })}
        </TabsWrapper>
      </TabsScrollContainer>

      <TabActions>
        <Tooltip title={t('common.new')} placement="bottom">
          <NewTabIconButton onClick={handleNewTab} theme={theme}>
            <PlusOutlined />
          </NewTabIconButton>
        </Tooltip>
      </TabActions>
    </Container>
  )
}

const Container = styled.div<{ theme: string }>`
  display: flex;
  align-items: center;
  height: 36px;
  background: ${({ theme }) => (theme === 'dark' ? 'var(--color-background)' : 'var(--color-background-soft)')};
  border-bottom: 1px solid var(--color-border);
  padding-left: 8px;
  user-select: none;
  -webkit-app-region: drag;
  position: relative;
  z-index: 100;
`

const TabsScrollContainer = styled.div`
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
  display: flex;
  align-items: center;
  height: 100%;
  scrollbar-width: none;
  -webkit-app-region: no-drag;

  &::-webkit-scrollbar {
    display: none;
  }
`

const TabsWrapper = styled.div`
  display: flex;
  align-items: center;
  height: 100%;
  gap: 1px;
  padding-right: 8px;
`

const TabActions = styled.div`
  display: flex;
  align-items: center;
  padding: 0 8px;
  height: 100%;
  -webkit-app-region: no-drag;
`

const NewTabIconButton = styled.button<{ theme: string }>`
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-2);
  transition: all 0.2s ease;
  font-size: 14px;

  &:hover {
    background: ${({ theme }) => (theme === 'dark' ? 'var(--color-background-soft)' : 'var(--color-background-mute)')};
    color: var(--color-text-1);
  }

  &:active {
    transform: scale(0.95);
  }
`

const EmptyState = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 20px;
  -webkit-app-region: no-drag;
`

const NewTabButton = styled.button<{ theme: string }>`
  padding: 6px 16px;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: ${({ theme }) => (theme === 'dark' ? 'var(--color-background-soft)' : 'var(--color-white)')};
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-2);
  font-size: 13px;
  transition: all 0.2s ease;

  &:hover {
    background: ${({ theme }) => (theme === 'dark' ? 'var(--color-background-mute)' : 'var(--color-background-soft)')};
    color: var(--color-text-1);
    border-color: var(--color-primary);
  }

  &:active {
    transform: scale(0.98);
  }
`

export default TabBar
