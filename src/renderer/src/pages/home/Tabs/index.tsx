import AddAssistantPopup from '@renderer/components/Popups/AddAssistantPopup'
import { useAssistants, useDefaultAssistant } from '@renderer/hooks/useAssistant'
import { useResize } from '@renderer/hooks/useResize'
import { useNavbarPosition, useSettings } from '@renderer/hooks/useSettings'
import { useShowTopics } from '@renderer/hooks/useStore'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { RootState } from '@renderer/store'
import { setResizeValue } from '@renderer/store/runtime'
import { Assistant, Topic } from '@renderer/types'
import { classNames, uuid } from '@renderer/utils'
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDispatch, useSelector } from 'react-redux'
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
  forceToSeeAllTab?: boolean
  style?: React.CSSProperties
}

type Tab = 'assistants' | 'topic' | 'settings'

let _tab: any = ''

const HomeTabs: FC<Props> = ({
  activeAssistant,
  activeTopic,
  setActiveAssistant,
  setActiveTopic,
  position,
  forceToSeeAllTab,
  style
}) => {
  const { addAssistant } = useAssistants()
  const [tab, setTab] = useState<Tab>(position === 'left' ? _tab || 'assistants' : 'topic')
  const { topicPosition } = useSettings()
  const { defaultAssistant } = useDefaultAssistant()
  const { toggleShowTopics } = useShowTopics()
  const { isLeftNavbar } = useNavbarPosition()
  const dispatch = useDispatch()
  const resizeKey = useMemo(() => {
    if (topicPosition === 'left' || (topicPosition === 'right' && tab === 'assistants')) {
      return 'chat-left-width'
    } else {
      return 'chat-right-width'
    }
  }, [tab, topicPosition])
  const savedWidth = useSelector((s: RootState) => s.runtime.chat.resizeValue[resizeKey])
  const { handleResize } = useResize()
  const containerRef = useRef<HTMLDivElement>(null)
  const resizeHandlerRef = useRef<HTMLDivElement>(null)

  const { t } = useTranslation()

  const borderStyle = '0.5px solid var(--color-border)'
  const border =
    position === 'left'
      ? { borderRight: isLeftNavbar ? borderStyle : 'none' }
      : { borderLeft: isLeftNavbar ? borderStyle : 'none', borderTopLeftRadius: 0 }

  if (position === 'left' && topicPosition === 'left') {
    _tab = tab
  }

  const showTab = position === 'left' && topicPosition === 'left'

  const onCreateAssistant = async () => {
    const assistant = await AddAssistantPopup.show()
    assistant && setActiveAssistant(assistant)
  }

  const onCreateDefaultAssistant = () => {
    const assistant = { ...defaultAssistant, id: uuid() }
    addAssistant(assistant)
    setActiveAssistant(assistant)
  }

  const setTabWidth = useCallback(
    (value: number) => {
      if (value !== savedWidth) {
        dispatch(setResizeValue({ key: resizeKey, value }))
      }
    },
    [dispatch, resizeKey, savedWidth]
  )

  useEffect(() => {
    if (resizeHandlerRef.current !== null && containerRef.current !== null) {
      handleResize(resizeHandlerRef.current, {
        direction: 'horizontal',
        x: {
          initial: containerRef.current.clientWidth,
          deltaSign: topicPosition === 'right' && tab !== 'assistants' ? -1 : 1,
          min: 200,
          max: 400
        },
        onResizing({ width: w }) {
          // 使用 css 减少不必要的渲染
          document.body.style.setProperty(`--${resizeKey}`, `${w}px`)
        },
        onResizeEnd({ width: w }) {
          setTabWidth(w)
          document.body.style.setProperty(`--${resizeKey}`, '')
        }
      })
    }
  }, [resizeHandlerRef, containerRef, handleResize, topicPosition, tab, setTabWidth, resizeKey])

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
    if (position === 'left' && topicPosition === 'right' && tab === 'topic') {
      setTab('assistants')
    }
  }, [position, tab, topicPosition, forceToSeeAllTab])

  return (
    <div
      style={{
        position: 'relative',
        height: '100%',
        width: `var(--${resizeKey}, ${savedWidth ? savedWidth + 'px' : 'var(--assistants-width)'})`
      }}>
      <Container
        ref={containerRef}
        style={{ ...border, ...style }}
        className={classNames('home-tabs', { right: position === 'right' && topicPosition === 'right' })}>
        {position === 'left' && topicPosition === 'left' && (
          <CustomTabs>
            <TabItem active={tab === 'assistants'} onClick={() => setTab('assistants')}>
              {t('assistants.abbr')}
            </TabItem>
            <TabItem active={tab === 'topic'} onClick={() => setTab('topic')}>
              {t('common.topics')}
            </TabItem>
            <TabItem active={tab === 'settings'} onClick={() => setTab('settings')}>
              {t('settings.title')}
            </TabItem>
          </CustomTabs>
        )}

        {position === 'right' && topicPosition === 'right' && (
          <CustomTabs>
            <TabItem active={tab === 'topic'} onClick={() => setTab('topic')}>
              {t('common.topics')}
            </TabItem>
            <TabItem active={tab === 'settings'} onClick={() => setTab('settings')}>
              {t('settings.title')}
            </TabItem>
          </CustomTabs>
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
            <Topics
              assistant={activeAssistant}
              activeTopic={activeTopic}
              setActiveTopic={setActiveTopic}
              position={position}
            />
          )}
          {tab === 'settings' && <Settings assistant={activeAssistant} />}
        </TabContent>
      </Container>
      <ResizeHandler
        ref={resizeHandlerRef}
        style={{
          right: topicPosition === 'left' || tab === 'assistants' ? '0' : '',
          left: topicPosition === 'right' && tab !== 'assistants' ? '0' : ''
        }}
      />
    </div>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  &.right {
    height: calc(100vh - var(--navbar-height));
  }
  [navbar-position='left'] & {
    background-color: var(--color-background);
  }
  [navbar-position='top'] & {
    height: calc(100vh - var(--navbar-height) - 12px);
    &.right {
      height: calc(100vh - var(--navbar-height) - var(--navbar-height) - 12px);
    }
  }
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
  overflow-y: hidden;
  overflow-x: hidden;
`

const CustomTabs = styled.div`
  display: flex;
  margin: 0 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--color-border);
  background: transparent;
  -webkit-app-region: no-drag;
  [navbar-position='top'] & {
    padding-top: 2px;
  }
`

const TabItem = styled.button<{ active: boolean }>`
  flex: 1;
  height: 32px;
  border: none;
  background: transparent;
  color: ${(props) => (props.active ? 'var(--color-text)' : 'var(--color-text-secondary)')};
  font-size: 13px;
  font-weight: ${(props) => (props.active ? '600' : '400')};
  cursor: pointer;
  border-radius: 8px;
  margin: 0 2px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    color: var(--color-text);
  }

  &:active {
    transform: scale(0.98);
  }

  &::after {
    content: '';
    position: absolute;
    bottom: -9px;
    left: 50%;
    transform: translateX(-50%);
    width: ${(props) => (props.active ? '30px' : '0')};
    height: 3px;
    background: var(--color-primary);
    border-radius: 1px;
    transition: all 0.2s ease;
  }

  &:hover::after {
    width: ${(props) => (props.active ? '30px' : '16px')};
    background: ${(props) => (props.active ? 'var(--color-primary)' : 'var(--color-primary-soft)')};
  }
`

const ResizeHandler = styled.div`
  position: absolute;
  top: 0px;
  bottom: 0px;
  height: 100%;
  width: 2px;
  background: var(--color-border);
  opacity: 0.1;
  transition: all 0.3s ease-in-out;
  cursor: col-resize;

  &:hover {
    opacity: 1;
  }
`

export default HomeTabs
