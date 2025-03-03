import { BarsOutlined, SettingOutlined } from '@ant-design/icons'
import AddAssistantPopup from '@renderer/components/Popups/AddAssistantPopup'
import { useAssistants, useDefaultAssistant } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShowTopics } from '@renderer/hooks/useStore'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { Assistant, Topic } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { Segmented as AntSegmented, SegmentedProps } from 'antd'
import { FC, useEffect, useState } from 'react'
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

type Tab = 'assistants' | 'topic' | 'settings'

let _tab: any = ''

const HomeTabs: FC<Props> = ({ activeAssistant, activeTopic, setActiveAssistant, setActiveTopic, position }) => {
  const { addAssistant } = useAssistants()
  const [tab, setTab] = useState<Tab>(position === 'left' ? _tab || 'assistants' : 'topic')
  const { topicPosition } = useSettings()
  const { defaultAssistant } = useDefaultAssistant()
  const { toggleShowTopics } = useShowTopics()

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
    value: 'assistants',
    icon: <i className="iconfont icon-business-smart-assistant" />
  }

  const onCreateAssistant = async () => {
    const assistant = await AddAssistantPopup.show()
    assistant && setActiveAssistant(assistant)
  }

  const onCreateDefaultAssistant = () => {
    const assistant = { ...defaultAssistant, id: uuid() }
    addAssistant(assistant)
    setActiveAssistant(assistant)
  }

  useEffect(() => {
    const unsubscribes = [
      EventEmitter.on(EVENT_NAMES.SHOW_ASSISTANTS, (): any => {
        showTab && setTab('assistants')
      }),
      EventEmitter.on(EVENT_NAMES.SHOW_TOPIC_SIDEBAR, (): any => {
        showTab && setTab('topic')
      }),
      EventEmitter.on(EVENT_NAMES.SHOW_CHAT_SETTINGS, (): any => {
        showTab && setTab('settings')
      }),
      EventEmitter.on(EVENT_NAMES.SWITCH_TOPIC_SIDEBAR, () => {
        showTab && setTab('topic')
        if (position === 'left' && topicPosition === 'right') {
          toggleShowTopics()
        }
      })
    ]
    return () => unsubscribes.forEach((unsub) => unsub())
  }, [position, showTab, tab, toggleShowTopics, topicPosition])

  useEffect(() => {
    if (position === 'right' && topicPosition === 'right' && tab === 'assistants') {
      setTab('topic')
    }
    if (position === 'left' && topicPosition === 'right' && tab !== 'assistants') {
      setTab('assistants')
    }
  }, [position, tab, topicPosition])

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
                value: 'topic',
                icon: <BarsOutlined />
              },
              {
                label: t('settings.title'),
                value: 'settings',
                icon: <SettingOutlined />
              }
            ].filter(Boolean) as SegmentedProps['options']
          }
          onChange={(value) => setTab(value as 'topic' | 'settings')}
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
  /* These styles ensure the same appearance as before */
  border-radius: 0;
  box-shadow: none;
`

export default HomeTabs
