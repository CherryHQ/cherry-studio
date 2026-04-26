import { RowFlex } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type { ContentSearchRef } from '@renderer/components/ContentSearch'
import { ContentSearch } from '@renderer/components/ContentSearch'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import { SelectChatModelPopup } from '@renderer/components/Popups/SelectModelPopup'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { isEmbeddingModel, isRerankModel, isWebSearchModel } from '@renderer/config/models'
import { fromSharedModel } from '@renderer/config/models/_bridge'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useTimer } from '@renderer/hooks/useTimer'
import { useTopicMutations } from '@renderer/hooks/useTopicDataApi'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Model, Topic } from '@renderer/types'
import { classNames } from '@renderer/utils'
import { AnimatePresence, motion } from 'motion/react'
import type { FC } from 'react'
import React, { useMemo, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'

import ChatNavbar from './components/ChatNavBar'
import Tabs from './Tabs'
import V2ChatContent from './V2ChatContent'

const logger = loggerService.withContext('Chat')

interface Props {
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
  /**
   * Called by V2ChatContent before the first message of a freshly-leased
   * temporary topic is sent. HomePage owns the lease so it also owns the
   * persist trigger. `initialName` becomes a placeholder topic title so
   * the sidebar isn't blank in the gap before auto-naming runs.
   */
  onPersistTemporaryTopic?: (initialName?: string) => Promise<void>
}

const Chat: FC<Props> = (props) => {
  const { assistant, model, setModel } = useAssistant(props.activeTopic.assistantId ?? '')
  const { updateTopic: patchTopic } = useTopicMutations()
  const v1Model = useMemo(() => (model ? fromSharedModel(model) : undefined), [model])
  const { t } = useTranslation()
  const [topicPosition] = usePreference('topic.position')
  const [messageStyle] = usePreference('chat.message.style')
  const [showTopics] = usePreference('topic.tab.show')
  const [isTopNavbar] = usePreference('ui.navbar.position')

  const mainRef = React.useRef<HTMLDivElement>(null)
  const contentSearchRef = useRef<ContentSearchRef>(null)
  const [filterIncludeUser, setFilterIncludeUser] = useState(false)
  const { setTimeoutTimer } = useTimer()

  useHotkeys('esc', () => {
    contentSearchRef.current?.disable()
  })

  useShortcut('chat.search_message', () => {
    try {
      const selectedText = window.getSelection()?.toString().trim()
      contentSearchRef.current?.enable(selectedText)
    } catch (error) {
      logger.error('Error enabling content search:', error as Error)
    }
  })

  useShortcut('topic.rename', async () => {
    const topic = props.activeTopic
    if (!topic) return

    void EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)

    const name = await PromptPopup.show({
      title: t('chat.topics.edit.title'),
      message: '',
      defaultValue: topic.name || '',
      extraNode: <div style={{ color: 'var(--color-text-3)', marginTop: 8 }}>{t('chat.topics.edit.title_tip')}</div>
    })
    if (name && topic.name !== name) {
      await patchTopic(topic.id, { name, isNameManuallyEdited: true })
    }
  })

  useShortcut('chat.select_model', async () => {
    if (!assistant) return
    const modelFilter = (m: Model) => !isEmbeddingModel(m) && !isRerankModel(m)
    const selectedModel = await SelectChatModelPopup.show({
      model: v1Model,
      filter: modelFilter
    })
    if (selectedModel) {
      const enabledWebSearch = isWebSearchModel(selectedModel)
      setModel(selectedModel, { enableWebSearch: enabledWebSearch && assistant.settings.enableWebSearch })
    }
  })

  const contentSearchFilter: NodeFilter = {
    acceptNode(node) {
      const container = node.parentElement?.closest('.message-content-container')
      if (!container) return NodeFilter.FILTER_REJECT
      const message = container.closest('.message')
      if (!message) return NodeFilter.FILTER_REJECT
      if (filterIncludeUser) return NodeFilter.FILTER_ACCEPT
      if (message.classList.contains('message-assistant')) return NodeFilter.FILTER_ACCEPT
      return NodeFilter.FILTER_REJECT
    }
  }

  const userOutlinedItemClickHandler = () => {
    setFilterIncludeUser(!filterIncludeUser)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeoutTimer(
          'userOutlinedItemClickHandler',
          () => {
            contentSearchRef.current?.search()
            contentSearchRef.current?.focus()
          },
          0
        )
      })
    })
  }

  const mainHeight = isTopNavbar ? 'calc(100vh - var(--navbar-height) - 6px)' : 'calc(100vh - var(--navbar-height))'

  return (
    <div
      id="chat"
      className={classNames([
        messageStyle,
        'flex h-[calc(100vh-var(--navbar-height))] flex-1 flex-col overflow-hidden',
        '[navbar-position=top]_&:h-[calc(100vh-var(--navbar-height)-6px)]',
        '[navbar-position=top]_&:bg-(--color-background)',
        '[navbar-position=top]_&:rounded-tl-[10px] [navbar-position=top]_&:rounded-bl-[10px]'
      ])}>
      <RowFlex>
        <motion.div
          layout
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          style={{ flex: 1, display: 'flex', minWidth: 0, overflow: 'hidden' }}>
          <div
            ref={mainRef}
            id="chat-main"
            className="transform-[translateZ(0)] relative flex flex-1 flex-col justify-between"
            style={{ height: mainHeight, width: '100%' }}>
            <QuickPanelProvider>
              <ChatNavbar assistantId={props.activeTopic.assistantId} />
              <V2ChatContent
                key={props.activeTopic.id}
                topic={props.activeTopic}
                setActiveTopic={props.setActiveTopic}
                mainHeight={mainHeight}
                onPersistTemporaryTopic={props.onPersistTemporaryTopic}
              />
              <ContentSearch
                ref={contentSearchRef}
                searchTarget={mainRef as React.RefObject<HTMLElement>}
                filter={contentSearchFilter}
                includeUser={filterIncludeUser}
                onIncludeUserChange={userOutlinedItemClickHandler}
              />
            </QuickPanelProvider>
          </div>
        </motion.div>
        <AnimatePresence initial={false}>
          {topicPosition === 'right' && showTopics && (
            <motion.div
              key="right-tabs"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'var(--assistants-width)', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              style={{
                overflow: 'hidden'
              }}>
              <Tabs activeTopic={props.activeTopic} setActiveTopic={props.setActiveTopic} position="right" />
            </motion.div>
          )}
        </AnimatePresence>
      </RowFlex>
    </div>
  )
}

export default Chat
