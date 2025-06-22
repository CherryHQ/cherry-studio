import { PlusOutlined } from '@ant-design/icons'
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates
} from '@dnd-kit/sortable'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { closeTab, openTab, reorderTabs, switchTab } from '@renderer/store/tabs'
import { createGroup } from '@renderer/store/tabs'
import { Tooltip } from 'antd'
import { AnimatePresence, motion } from 'framer-motion'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AnimatedTabItem from './AnimatedTabItem'
import DraggableTabItem from './DraggableTabItem'
import { TabGroup } from './TabGroup'

const DraggableTabBar: React.FC = () => {
  const dispatch = useAppDispatch()
  const { tabs, tabOrder, activeTabId, groups } = useAppSelector((state) => state.tabs)
  const { hideMinappPopup } = useMinappPopup()
  const { theme } = useTheme()
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8
      }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

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

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (active.id !== over?.id) {
      const oldIndex = tabOrder.indexOf(active.id as string)
      const newIndex = tabOrder.indexOf(over?.id as string)

      const newOrder = arrayMove(tabOrder, oldIndex, newIndex)
      dispatch(reorderTabs(newOrder))
    }

    setActiveId(null)
  }

  const activeTab = activeId ? tabs.find((t) => t.id === activeId) : null

  // Organize tabs by groups
  const groupedTabs = tabs.reduce(
    (acc, tab) => {
      const groupId = tab.groupId || 'ungrouped'
      if (!acc[groupId]) acc[groupId] = []
      acc[groupId].push(tab)
      return acc
    },
    {} as Record<string, typeof tabs>
  )

  const handleCreateGroup = () => {
    const groupName = prompt(t('tabs.newGroupName') || 'New group name?')
    if (groupName) {
      dispatch(createGroup({ name: groupName }))
    }
  }

  const handleNewTabInGroup = (groupId: string) => {
    hideMinappPopup()
    dispatch(
      openTab({
        type: 'page',
        route: '/',
        title: t('assistants.title'),
        canClose: true,
        isPinned: false,
        groupId
      })
    )
  }

  // Handle empty state - no tabs open
  if (tabs.length === 0) {
    return (
      <Container theme={theme}>
        <DragHandle />
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
      <DragHandle />
      <TabContent>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}>
          <TabsScrollContainer ref={scrollContainerRef}>
            <TabsWrapper>
              <SortableContext items={tabOrder} strategy={horizontalListSortingStrategy}>
                <AnimatePresence mode="popLayout">
                  {/* Render tab groups */}
                  {groups.map((group) => {
                    const groupTabs = groupedTabs[group.id] || []
                    if (groupTabs.length === 0) return null

                    return (
                      <TabGroup
                        key={group.id}
                        group={group}
                        tabs={groupTabs}
                        onAddTab={() => handleNewTabInGroup(group.id)}>
                        {groupTabs.map((tab, index) => (
                          <DraggableTabItem
                            key={tab.id}
                            tab={tab}
                            isActive={tab.id === activeTabId}
                            onClick={() => handleTabClick(tab.id)}
                            onClose={(e) => handleTabClose(e, tab.id)}
                            index={index}
                            isDragging={activeId === tab.id}
                          />
                        ))}
                      </TabGroup>
                    )
                  })}

                  {/* Render ungrouped tabs */}
                  {groupedTabs.ungrouped?.map((tab, index) => (
                    <DraggableTabItem
                      key={tab.id}
                      tab={tab}
                      isActive={tab.id === activeTabId}
                      onClick={() => handleTabClick(tab.id)}
                      onClose={(e) => handleTabClose(e, tab.id)}
                      index={index}
                      isDragging={activeId === tab.id}
                    />
                  ))}
                </AnimatePresence>
              </SortableContext>
            </TabsWrapper>
          </TabsScrollContainer>

          <DragOverlay>
            {activeId && activeTab ? (
              <DragOverlayContent theme={theme}>
                <AnimatedTabItem tab={activeTab} isActive={false} onClick={() => {}} onClose={() => {}} index={0} />
              </DragOverlayContent>
            ) : null}
          </DragOverlay>
        </DndContext>

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

          <Tooltip title={t('tabs.newGroup') || 'New Group'} placement="bottom">
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <NewTabIconButton onClick={handleCreateGroup} theme={theme}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM10 10v1h1v2h2v-2h1v-1h-1V8h-2v2h-1z" />
                </svg>
              </NewTabIconButton>
            </motion.div>
          </Tooltip>
        </TabActions>

        {/* Gradient overlays for scroll indication */}
        <ScrollGradientLeft theme={theme} />
        <ScrollGradientRight theme={theme} />
      </TabContent>
    </Container>
  )
}

const Container = styled.div<{ theme: string }>`
  display: flex;
  flex-direction: column;
  background: ${({ theme }) => (theme === 'dark' ? 'var(--color-background)' : 'var(--color-background-soft)')};
  border-bottom: 1px solid var(--color-border);
  user-select: none;
  position: relative;
  z-index: 100;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
`

const DragHandle = styled.div`
  height: 20px;
  width: 100%;
  -webkit-app-region: drag;
  flex-shrink: 0;
  cursor: move;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;

  &::before {
    content: '';
    width: 40px;
    height: 3px;
    background: var(--color-border);
    border-radius: 2px;
    opacity: 0.3;
    transition: opacity 0.2s;
  }

  &:hover::before {
    opacity: 0.6;
  }
`

const TabContent = styled.div`
  display: flex;
  flex: 1;
  min-height: 40px;
  -webkit-app-region: no-drag;
  position: relative;
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
  gap: 8px;
  padding: 4px 8px;
  min-height: 100%;
  -webkit-app-region: no-drag;
`

const TabActions = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
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

const DragOverlayContent = styled.div<{ theme: string }>`
  cursor: grabbing;
  opacity: 0.9;
  transform: scale(1.05);
  filter: drop-shadow(0 10px 20px rgba(0, 0, 0, 0.3));
`

export default DraggableTabBar
