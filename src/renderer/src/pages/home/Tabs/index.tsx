import AddAssistantPopup from '@renderer/components/Popups/AddAssistantPopup'
import { useAssistants, useDefaultAssistant } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShowTopics } from '@renderer/hooks/useStore'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { Assistant, Topic } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { Segmented as AntSegmented, SegmentedProps } from 'antd'
import { FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import Assistants from './AssistantsTab'
import Settings from './SettingsTab'
import Topics from './TopicsTab'

interface Props {
  activeAssistant: Assistant
  activeTopic: Topic
  setActiveAssistant: (assistant: Assistant) => void
  setActiveTopic: (topic: Topic) => void
  position: 'left' | 'right'
}

type Tab = 'assistants' | 'topic' | 'bookmarks' | 'settings'

let _tab: any = ''

const HomeTabs: FC<Props> = ({ activeAssistant, activeTopic, setActiveAssistant, setActiveTopic, position }) => {
  const { addAssistant, assistants } = useAssistants()
  const [tab, setTab] = useState<Tab>(position === 'left' ? _tab || 'assistants' : 'topic')
  const { topicPosition } = useSettings()
  const { defaultAssistant, bookmarkAssistant } = useDefaultAssistant()
  const { toggleShowTopics } = useShowTopics()

  const [lastActiveMainAssistant, setLastActiveMainAssistant] = useState<Assistant | null>(() =>
    activeAssistant && activeAssistant.id !== 'bookmarks' ? activeAssistant : null
  )

  const { t } = useTranslation()

  const borderStyle = '0.5px solid var(--color-border)'
  const border =
    position === 'left' ? { borderRight: borderStyle } : { borderLeft: borderStyle, borderTopLeftRadius: 0 }

  if (position === 'left' && topicPosition === 'left') {
    _tab = tab
  }

  const showTab = !(position === 'left' && topicPosition === 'right')

  const assistantTab = {
    label: t('assistants.abbr'),
    value: 'assistants'
  }

  const onCreateAssistant = async () => {
    const assistant = await AddAssistantPopup.show()
    assistant && setActiveAssistant(assistant)
  }

  const onCreateDefaultAssistant = () => {
    const assistant = { ...defaultAssistant, id: uuid() }
    const bookmarks_assistant = {
      ...bookmarkAssistant,
      id: 'bookmarks',
      topics: []
    }
    addAssistant(assistant)
    addAssistant(bookmarks_assistant)
    setActiveAssistant(assistant)
  }

  const switchToTopicTab = useCallback(() => {
    if (lastActiveMainAssistant && activeAssistant && activeAssistant.id === 'bookmarks') {
      setActiveAssistant(lastActiveMainAssistant)
    } else if (!activeAssistant && lastActiveMainAssistant) {
      setActiveAssistant(lastActiveMainAssistant)
    } else if (activeAssistant && activeAssistant.id !== 'bookmarks') {
      // Already on a main assistant, or lastActiveMainAssistant is the current one
    } else if (!lastActiveMainAssistant && assistants.length > 0) {
      // Fallback if no lastActiveMainAssistant
      const firstNonBookmark = assistants.find((a) => a.id !== 'bookmarks')
      if (firstNonBookmark && (!activeAssistant || activeAssistant.id === 'bookmarks')) {
        setActiveAssistant(firstNonBookmark)
      } else if (assistants[0] && (!activeAssistant || activeAssistant.id === 'bookmarks')) {
        setActiveAssistant(assistants[0])
      }
    }
    setTab('topic')
  }, [activeAssistant, setActiveAssistant, lastActiveMainAssistant, assistants])

  const switchToAssistantsTab = useCallback(() => {
    if (lastActiveMainAssistant) {
      setActiveAssistant(lastActiveMainAssistant)
    } else {
      const firstNonBookmark = assistants.find((a) => a.id !== 'bookmarks')
      if (firstNonBookmark) {
        setActiveAssistant(firstNonBookmark)
      } else if (assistants.length > 0) {
        setActiveAssistant(assistants[0])
      }
    }
    setTab('assistants')
  }, [setActiveAssistant, lastActiveMainAssistant, assistants])

  useEffect(() => {
    // 當切換書籤助手時，將最後一個主助手保存到狀態中
    if (activeAssistant && activeAssistant.id !== 'bookmarks') {
      setLastActiveMainAssistant(activeAssistant)
    }
    const unsubscribes = [
      EventEmitter.on(EVENT_NAMES.SHOW_ASSISTANTS, (): any => {
        showTab && switchToAssistantsTab()
      }),
      EventEmitter.on(EVENT_NAMES.SHOW_TOPIC_SIDEBAR, (): any => {
        showTab && switchToTopicTab()
      }),
      // EventEmitter.on(EVENT_NAMES.SHOW_BOOKMARKS_SIDEBAR, (): any => {
      //   showTab && setTab('bookmarks')
      // }),
      EventEmitter.on(EVENT_NAMES.SHOW_CHAT_SETTINGS, (): any => {
        showTab && setTab('settings')
      }),
      EventEmitter.on(EVENT_NAMES.SWITCH_TOPIC_SIDEBAR, () => {
        showTab && switchToTopicTab()
        if (position === 'left' && topicPosition === 'right') {
          toggleShowTopics()
        }
      }),
      EventEmitter.on(EVENT_NAMES.SWITCH_BOOKMARKS_SIDEBAR, (): any => {
        showTab && setTab('bookmarks')
        if (position === 'left' && topicPosition === 'right') {
          toggleShowTopics()
        }
      })
    ]
    return () => unsubscribes.forEach((unsub) => unsub())
  }, [
    activeAssistant,
    position,
    showTab,
    switchToAssistantsTab,
    switchToTopicTab,
    tab,
    toggleShowTopics,
    topicPosition
  ])

  useEffect(() => {
    if (position === 'right' && topicPosition === 'right' && tab === 'assistants') {
      switchToTopicTab()
    }
    if (position === 'left' && topicPosition === 'right' && tab !== 'assistants') {
      switchToAssistantsTab()
    }
  }, [position, switchToAssistantsTab, switchToTopicTab, tab, topicPosition])

  return (
    <Container style={border} className="home-tabs">
      {showTab && (
        <Segmented
          value={tab}
          style={{ borderRadius: 16, paddingTop: 10, margin: '0 10px', gap: 2 }}
          options={
            [
              position === 'left' && topicPosition === 'left' ? assistantTab : undefined,
              {
                label: t('common.topics'),
                value: 'topic'
              },
              {
                label: t('common.bookmarks'),
                value: 'bookmarks'
              },
              {
                label: t('settings.title'),
                value: 'settings'
              }
            ].filter(Boolean) as SegmentedProps['options']
          }
          // onChange={(value) => setTab(value as 'topic' | 'settings')}
          onChange={(value) => {
            const newTab = value as Tab
            if (newTab === 'topic') {
              switchToTopicTab()
            } else if (newTab === 'assistants') {
              switchToAssistantsTab()
            } else {
              setTab(newTab)
            }
          }}
          block
        />
      )}
      <TabContent className="home-tabs-content">
        {tab === 'assistants' && (
          <Assistants
            activeAssistant={activeAssistant}
            setActiveAssistant={setActiveAssistant}
            onCreateAssistant={onCreateAssistant}
            onCreateDefaultAssistant={onCreateDefaultAssistant}
          />
        )}
        {tab === 'topic' && (
          <Topics assistant={activeAssistant} activeTopic={activeTopic} setActiveTopic={setActiveTopic} />
        )}
        {tab === 'bookmarks' &&
          (() => {
            const currentBookmarksAssistant = assistants.find((a) => a.id === 'bookmarks') || {
              ...bookmarkAssistant,
              id: 'bookmarks',
              topics: []
            }
            return (
              <Topics
                assistant={currentBookmarksAssistant}
                activeTopic={activeTopic}
                setActiveTopic={(topicToActivate) => {
                  setActiveAssistant(currentBookmarksAssistant) // Crucial: Set active assistant to bookmarks
                  setActiveTopic(topicToActivate)
                }}
              />
            )
          })()}
        {tab === 'settings' && <Settings assistant={activeAssistant} />}
      </TabContent>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  max-width: var(--assistants-width);
  min-width: var(--assistants-width);
  height: calc(100vh - var(--navbar-height));
  background-color: var(--color-background);
  overflow: hidden;
  .collapsed {
    width: 0;
    border-left: none;
  }
`

const TabContent = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
`

const Segmented = styled(AntSegmented)`
  &.ant-segmented {
    background-color: transparent;
    border-radius: 0 !important;
    border-bottom: 0.5px solid var(--color-border);
    padding-bottom: 10px;
  }
  .ant-segmented-item {
    overflow: hidden;
    transition: none !important;
    height: 34px;
    line-height: 34px;
    background-color: transparent;
    user-select: none;
    border-radius: var(--list-item-border-radius);
    box-shadow: none;
  }
  .ant-segmented-item-selected {
    background-color: var(--color-background-soft);
    border: 0.5px solid var(--color-border);
    transition: none !important;
  }
  .ant-segmented-item-label {
    align-items: center;
    display: flex;
    flex-direction: row;
    justify-content: center;
    font-size: 13px;
    height: 100%;
  }
  .ant-segmented-item-label[aria-selected='true'] {
    color: var(--color-text);
  }
  .iconfont {
    font-size: 13px;
    margin-left: -2px;
  }
  .anticon-setting {
    font-size: 12px;
  }
  .icon-business-smart-assistant {
    margin-right: -2px;
  }
  .ant-segmented-item-icon + * {
    margin-left: 4px;
  }
  .ant-segmented-thumb {
    transition: none !important;
    background-color: var(--color-background-soft);
    border: 0.5px solid var(--color-border);
    border-radius: var(--list-item-border-radius);
    box-shadow: none;
  }
  .ant-segmented-item-label,
  .ant-segmented-item-icon {
    display: flex;
    align-items: center;
  }
  /* These styles ensure the same appearance as before */
  border-radius: 0;
  box-shadow: none;
`

export default HomeTabs
