import EmojiIcon from '@renderer/components/EmojiIcon'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { selectTopicsMap } from '@renderer/store/assistants'
import type { TopicTabItem } from '@renderer/store/topicTabs'
import { removeTopicTab, setActiveTopicTab } from '@renderer/store/topicTabs'
import type { Topic } from '@renderer/types'
import { X } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'

const TopicTabBar: FC = () => {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const { openTabs, activeTabId } = useAppSelector((state) => state.topicTabs)
  const topicsMap = useAppSelector(selectTopicsMap)
  const assistants = useAppSelector((state) => state.assistants.assistants)
  const hasHydrated = useRef(false)

  const assistantsMap = useMemo(() => new Map(assistants.map((a) => [a.id, a])), [assistants])

  useEffect(() => {
    const unsubscribe = EventEmitter.on(EVENT_NAMES.CHANGE_TOPIC, (topic: Topic) => {
      dispatch(setActiveTopicTab(topic.id))
    })
    return () => unsubscribe()
  }, [dispatch])

  useEffect(() => {
    if (topicsMap.size === 0 || openTabs.length === 0) return
    if (!hasHydrated.current) {
      hasHydrated.current = true
      return
    }
    for (const tab of openTabs) {
      if (!topicsMap.has(tab.topicId)) {
        dispatch(removeTopicTab(tab.topicId))
      }
    }
  }, [openTabs, topicsMap, dispatch])

  const handleTabClick = (tab: TopicTabItem) => {
    if (tab.topicId === activeTabId) return

    const topic = topicsMap.get(tab.topicId)
    const assistant = assistantsMap.get(tab.assistantId)

    if (!topic || !assistant) {
      dispatch(removeTopicTab(tab.topicId))
      return
    }

    navigate('/', { state: { assistant, topic } })
    dispatch(setActiveTopicTab(tab.topicId))
  }

  const handleTabClose = (topicId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    dispatch(removeTopicTab(topicId))
  }

  const handleMiddleClick = (tab: TopicTabItem, e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault()
      e.stopPropagation()
      dispatch(removeTopicTab(tab.topicId))
    }
  }

  return (
    <TabBarContainer className={openTabs.length > 0 ? 'expanded' : 'collapsed'}>
      <TabList>
        {openTabs.map((tab) => {
          const topic = topicsMap.get(tab.topicId)
          const assistant = assistantsMap.get(tab.assistantId)

          if (!topic || !assistant) return null

          const isActive = tab.topicId === activeTabId

          return (
            <TabItem
              key={tab.topicId}
              $active={isActive}
              onClick={() => handleTabClick(tab)}
              onAuxClick={(e) => handleMiddleClick(tab, e)}>
              <TabHeader>
                <EmojiIcon emoji={assistant.emoji || '💬'} size={18} fontSize={11} />
                <AssistantName>{assistant.name}</AssistantName>
                <Separator>&gt;</Separator>
                <TabTitle title={topic.name}>{topic.name}</TabTitle>
              </TabHeader>
              <CloseButton className="close-button" onClick={(e) => handleTabClose(tab.topicId, e)}>
                <X size={12} />
              </CloseButton>
            </TabItem>
          )
        })}
      </TabList>
    </TabBarContainer>
  )
}

const TabBarContainer = styled.div`
  display: flex;
  align-items: center;
  padding: 0 8px;
  white-space: nowrap;
  transition:
    max-height 0.25s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.2s ease-in-out;

  &.collapsed {
    max-height: 0;
    min-height: 0;
    opacity: 0;
    border-bottom: none;
    padding: 0;
    overflow: hidden;
  }

  &.expanded {
    max-height: 36px;
    min-height: 36px;
    opacity: 1;
    border-bottom: 0.5px solid var(--color-border);
    overflow-x: auto;
    overflow-y: hidden;
  }

  &::-webkit-scrollbar {
    height: 3px;
  }
  &::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border-radius: 2px;
  }
`

const TabList = styled.div`
  display: flex;
  gap: 4px;
  align-items: center;
`

const TabItem = styled.div<{ $active: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  padding-right: 6px;
  height: 28px;
  min-width: 80px;
  max-width: 240px;
  border-radius: var(--list-item-border-radius);
  cursor: pointer;
  user-select: none;
  background: ${(props) => (props.$active ? 'var(--color-list-item)' : 'transparent')};
  transition: background 0.2s;

  .close-button {
    opacity: 0;
    transition: opacity 0.2s;
  }

  &:hover {
    background: var(--color-list-item);
    .close-button {
      opacity: 1;
    }
  }
`

const TabHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
`

const AssistantName = styled.span`
  color: var(--color-text-3);
  font-size: 11px;
  white-space: nowrap;
  flex-shrink: 0;
  max-width: 70px;
  overflow: hidden;
  text-overflow: ellipsis;
`

const Separator = styled.span`
  color: var(--color-text-3);
  font-size: 10px;
  flex-shrink: 0;
`

const TabTitle = styled.span`
  color: var(--color-text);
  font-size: 12px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`

const CloseButton = styled.span`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  margin-left: 4px;
  border-radius: 3px;
  color: var(--color-text-2);

  &:hover {
    color: var(--color-error);
    background: var(--color-background-mute);
  }
`

export default TopicTabBar
