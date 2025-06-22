import { PlusOutlined } from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { closeTab, openTab, switchTab } from '@renderer/store/tabs'
import { Tooltip } from 'antd'
import { AnimatePresence, motion } from 'framer-motion'
import React, { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AnimatedTabItem from './AnimatedTabItem'

const AnimatedTabBar: React.FC = () => {
  const dispatch = useAppDispatch()
  const { tabs, tabOrder, activeTabId } = useAppSelector((state) => state.tabs)
  const { hideMinappPopup } = useMinappPopup()
  const { theme } = useTheme()
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to active tab with smooth animation
  useEffect(() => {
    if (activeTabId && scrollContainerRef.current) {
      const activeElement = scrollContainerRef.current.querySelector(`[data-tab-id="${activeTabId}"]`)
      if (activeElement) {
        activeElement.scrollIntoView({
          behavior: 'smooth',
          inline: 'center',
          block: 'nearest'
        })
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
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <NewTabButton onClick={handleNewTab} theme={theme}>
              <PlusOutlined />
              <span>{t('common.new')}</span>
            </NewTabButton>
          </motion.div>
        </EmptyState>
      </Container>
    )
  }

  return (
    <Container ref={containerRef} theme={theme}>
      <TabsScrollContainer ref={scrollContainerRef}>
        <TabsWrapper>
          <AnimatePresence mode="popLayout">
            {tabOrder.map((tabId, index) => {
              const tab = tabs.find((t) => t.id === tabId)
              if (!tab) return null

              return (
                <AnimatedTabItem
                  key={tab.id}
                  tab={tab}
                  isActive={tab.id === activeTabId}
                  onClick={() => handleTabClick(tab.id)}
                  onClose={(e) => handleTabClose(e, tab.id)}
                  index={index}
                />
              )
            })}
          </AnimatePresence>
        </TabsWrapper>
      </TabsScrollContainer>

      <TabActions>
        <Tooltip title={t('common.new')} placement="bottom">
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <NewTabIconButton onClick={handleNewTab} theme={theme}>
              <motion.div animate={{ rotate: 180 }} transition={{ duration: 0.3 }} whileHover={{ rotate: 360 }}>
                <PlusOutlined />
              </motion.div>
            </NewTabIconButton>
          </motion.div>
        </Tooltip>
      </TabActions>

      {/* Gradient overlays for scroll indication */}
      <ScrollGradientLeft theme={theme} />
      <ScrollGradientRight theme={theme} />
    </Container>
  )
}

const Container = styled.div<{ theme: string }>`
  display: flex;
  align-items: center;
  height: 40px;
  background: ${({ theme }) => (theme === 'dark' ? 'var(--color-background)' : 'var(--color-background-soft)')};
  border-bottom: 1px solid var(--color-border);
  padding-left: 8px;
  user-select: none;
  -webkit-app-region: drag;
  position: relative;
  z-index: 100;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
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
  scroll-behavior: smooth;

  &::-webkit-scrollbar {
    display: none;
  }
`

const TabsWrapper = styled.div`
  display: flex;
  align-items: center;
  height: 100%;
  gap: 2px;
  padding: 4px 8px 0 0;
`

const TabActions = styled.div`
  display: flex;
  align-items: center;
  padding: 0 8px;
  height: 100%;
  -webkit-app-region: no-drag;
`

const NewTabIconButton = styled.button<{ theme: string }>`
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-2);
  transition: all 0.2s ease;
  font-size: 16px;

  &:hover {
    background: ${({ theme }) => (theme === 'dark' ? 'var(--color-background-soft)' : 'var(--color-background-mute)')};
    color: var(--color-primary);
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
  padding: 8px 20px;
  border-radius: 8px;
  border: 2px dashed var(--color-border);
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-2);
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s ease;

  &:hover {
    background: ${({ theme }) => (theme === 'dark' ? 'var(--color-background-soft)' : 'var(--color-background-soft)')};
    color: var(--color-primary);
    border-color: var(--color-primary);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }
`

const ScrollGradientLeft = styled.div<{ theme: string }>`
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 20px;
  background: ${({ theme }) =>
    theme === 'dark'
      ? 'linear-gradient(90deg, var(--color-background) 0%, transparent 100%)'
      : 'linear-gradient(90deg, var(--color-background-soft) 0%, transparent 100%)'};
  pointer-events: none;
  z-index: 1;
`

const ScrollGradientRight = styled.div<{ theme: string }>`
  position: absolute;
  right: 50px;
  top: 0;
  bottom: 0;
  width: 20px;
  background: ${({ theme }) =>
    theme === 'dark'
      ? 'linear-gradient(270deg, var(--color-background) 0%, transparent 100%)'
      : 'linear-gradient(270deg, var(--color-background-soft) 0%, transparent 100%)'};
  pointer-events: none;
  z-index: 1;
`

export default AnimatedTabBar
