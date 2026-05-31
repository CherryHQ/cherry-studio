import { RowFlex } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type { ContentSearchRef } from '@renderer/components/ContentSearch'
import { ContentSearch } from '@renderer/components/ContentSearch'
import MultiSelectActionPopup from '@renderer/components/Popups/MultiSelectionPopup'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import { SelectChatModelPopup } from '@renderer/components/Popups/SelectModelPopup'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { isEmbeddingModel, isRerankModel, isWebSearchModel } from '@renderer/config/models'
import { BranchAnchorContext, type BranchAnchorContextValue } from '@renderer/context/BranchAnchorContext'
import { BranchAssistantContext, type BranchAssistantOverride } from '@renderer/context/BranchAssistantContext'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useBranchFork } from '@renderer/hooks/useBranchFork'
import { useChatContext } from '@renderer/hooks/useChatContext'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useShowTopics } from '@renderer/hooks/useStore'
import { useTimer } from '@renderer/hooks/useTimer'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Assistant, Model, Topic } from '@renderer/types'
import { classNames } from '@renderer/utils'
import { clearSourceHighlight } from '@renderer/utils/branchAnchor/sourceHighlight'
import { Flex } from 'antd'
import { debounce } from 'lodash'
import { AnimatePresence, motion } from 'motion/react'
import type { FC } from 'react'
import React, { useCallback, useMemo, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { v4 as uuidv4 } from 'uuid'

import ChatNavbar from './components/ChatNavBar'
import Inputbar from './Inputbar/Inputbar'
import { type Branch, BRANCH_HL_DEFAULT_COLOR, type BranchAnchor, BranchPane } from './Messages/BranchPanel'
import ChatNavigation from './Messages/ChatNavigation'
import Messages from './Messages/Messages'
import Tabs from './Tabs'

const logger = loggerService.withContext('Chat')

interface Props {
  assistant: Assistant
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
  setActiveAssistant: (assistant: Assistant) => void
}

const Chat: FC<Props> = (props) => {
  const { assistant, updateAssistant, updateTopic } = useAssistant(props.assistant.id)
  const { t } = useTranslation()
  const [topicPosition] = usePreference('topic.position')
  const [messageStyle] = usePreference('chat.message.style')
  const [messageNavigation] = usePreference('chat.message.navigation_mode')
  const { showTopics } = useShowTopics()
  const { isMultiSelectMode } = useChatContext(props.activeTopic)
  const [isTopNavbar] = usePreference('ui.navbar.position')

  const mainRef = React.useRef<HTMLDivElement>(null)
  const contentSearchRef = React.useRef<ContentSearchRef>(null)
  const [filterIncludeUser, setFilterIncludeUser] = useState(false)

  // P1-S1 state foundation: the legacy `branchAnchor + branchTopic` pair is
  // generalized to a `branches[]` array. INVARIANT (S1): branches.length ≤ 1
  // — there is no UI today that opens a second branch. The list shape is the
  // state foundation S2 builds on; at length ≤ 1 every downstream derivation
  // collapses to bit-for-bit the same runtime values the old shape produced.
  //
  // collapsedBranchIds is reserved for the S2 collapse/expand UI and is
  // unused at S1; it always starts empty (= all expanded) and is reset to
  // empty on close along with branches.
  const [branches, setBranches] = useState<Branch[]>([])
  const [, setCollapsedBranchIds] = useState<Set<string>>(() => new Set())

  // S1: a fresh anchor REPLACES branches (only one allowed now). The new
  // Branch starts with `topic: null` to mirror the previous "anchor first,
  // POST /topics later" two-phase timing. `id` is client-generated so it's
  // stable from anchor-emit through topic-creation through close.
  //
  // S2a: every new branch gets the default palette color (c1, legacy amber).
  // S2b will cycle through the palette as multiple branches open
  // concurrently. The S1 invariant (branches.length ≤ 1) means we never
  // need to disambiguate today; same color is fine.
  const openBranchAnchor = useCallback((anchor: BranchAnchor) => {
    setBranches([
      {
        id: uuidv4(),
        source: {
          messageId: anchor.messageId,
          blockId: anchor.blockId,
          selectedText: anchor.selectedText,
          offsets: { start: anchor.selectionStart, end: anchor.selectionEnd }
        },
        topic: null,
        createdAt: Date.now(),
        color: BRANCH_HL_DEFAULT_COLOR
      }
    ])
  }, [])

  const branchFork = useBranchFork({
    assistant,
    topic: props.activeTopic,
    onCreated: (created) => {
      // S1 invariant: branches.length ≤ 1. Attach the created topic to the
      // (single) currently-composing branch — the one whose `topic` is still
      // null. Functional updater keeps this race-safe if branches changes
      // between the fork start and onCreated.
      setBranches((prev) => prev.map((b) => (b.topic === null ? { ...b, topic: created } : b)))
    }
  })

  // Compose-time facade for BranchPane and useBranchFork.fork(): both APIs
  // still take a single BranchAnchor today (they're outside this refactor's
  // touch-list). At S1 invariant length ≤ 1, branches[0] is the only one.
  const activeBranch = branches[0] ?? null
  const composerAnchor: BranchAnchor | null = useMemo(
    () =>
      activeBranch
        ? {
            messageId: activeBranch.source.messageId,
            blockId: activeBranch.source.blockId,
            selectedText: activeBranch.source.selectedText,
            selectionStart: activeBranch.source.offsets.start,
            selectionEnd: activeBranch.source.offsets.end
          }
        : null,
    [activeBranch]
  )
  const activeBranchTopic: Topic | null = activeBranch?.topic ?? null

  // Synthetic assistant for the branch subtree. Same id as the main assistant,
  // but `.topics` transiently carries the branch topic(s) (with `prompt` set
  // by useBranchFork). messageThunk:854 reads `topic.prompt` from this
  // object's `.topics` array — that's why regenerate / resend / edit / delete
  // inside the branch must see this synthetic, not the Redux one. Stable
  // reference via useMemo so useAssistant's downstream useMemo / useEffect
  // don't churn. At branches.length ≤ 1 this is byte-identical to the
  // previous single-branchTopic shape.
  const branchTopics = useMemo(() => branches.map((b) => b.topic).filter((t): t is Topic => t !== null), [branches])
  const branchOverride = useMemo<BranchAssistantOverride | null>(() => {
    if (branchTopics.length === 0) return null
    return {
      assistant: { ...assistant, topics: [...assistant.topics, ...branchTopics] }
    }
  }, [assistant, branchTopics])

  // T-006D-2B S6' / P1-S1: source-passage highlight as a list of anchors.
  // branches stay alive for the whole branch lifetime (onCreated does not
  // clear them), so the exact selected passage(s) are highlighted from
  // branch-open through branch-close. At branches.length ≤ 1 this collapses
  // to exactly the previous { highlightedBlockId, selectionStart/End } object
  // — just wrapped in an array of length 1.
  const branchAnchorHighlight = useMemo<BranchAnchorContextValue>(
    () => ({
      anchors: branches.map((b) => ({
        branchId: b.id,
        blockId: b.source.blockId,
        selectionStart: b.source.offsets.start,
        selectionEnd: b.source.offsets.end,
        color: b.color
      }))
    }),
    [branches]
  )

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
      const updatedTopic = { ...topic, name, isNameManuallyEdited: true }
      updateTopic(updatedTopic as Topic)
    }
  })

  useShortcut('chat.select_model', async () => {
    const modelFilter = (m: Model) => !isEmbeddingModel(m) && !isRerankModel(m)
    const selectedModel = await SelectChatModelPopup.show({
      model: assistant?.model,
      filter: modelFilter
    })
    if (selectedModel) {
      const enabledWebSearch = isWebSearchModel(selectedModel)
      updateAssistant({
        model: selectedModel,
        enableWebSearch: enabledWebSearch && assistant.enableWebSearch
      })
    }
  })

  const contentSearchFilter: NodeFilter = {
    acceptNode(node) {
      const container = node.parentElement?.closest('.message-content-container')
      if (!container) return NodeFilter.FILTER_REJECT

      const message = container.closest('.message')
      if (!message) return NodeFilter.FILTER_REJECT

      if (filterIncludeUser) {
        return NodeFilter.FILTER_ACCEPT
      }
      if (message.classList.contains('message-assistant')) {
        return NodeFilter.FILTER_ACCEPT
      }
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

  let firstUpdateCompleted = false
  const firstUpdateOrNoFirstUpdateHandler = debounce(() => {
    contentSearchRef.current?.silentSearch()
  }, 10)

  const messagesComponentUpdateHandler = () => {
    if (firstUpdateCompleted) {
      firstUpdateOrNoFirstUpdateHandler()
    }
  }

  const messagesComponentFirstUpdateHandler = () => {
    setTimeoutTimer('messagesComponentFirstUpdateHandler', () => (firstUpdateCompleted = true), 300)
    firstUpdateOrNoFirstUpdateHandler()
  }

  const mainHeight = isTopNavbar ? 'calc(100vh - var(--navbar-height) - 6px)' : 'calc(100vh - var(--navbar-height))'

  return (
    <Container id="chat" className={classNames([messageStyle, { 'multi-select-mode': isMultiSelectMode }])}>
      {/*
        T-006D-2B S5' scroll-fix: Container is a flex column with a bounded
        height (calc(100vh - var(--navbar-height))). RowFlex sits inside as a
        column-flex item without an intrinsic height — main chat works only
        because <Main> overrides via inline `style={{ height: mainHeight }}`.
        BranchPane doesn't carry that override, so without h-full here its
        motion.div has no height anchor and the inner overflow-y-auto can't
        scroll. h-full propagates the Container height down into RowFlex →
        BranchPane → BranchMessageStream.
      */}
      <RowFlex className="h-full">
        <motion.div
          layout
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          style={{ flex: 1, display: 'flex', minWidth: 0, overflow: 'hidden' }}>
          <Main
            ref={mainRef}
            id="chat-main"
            vertical
            flex={1}
            justify="space-between"
            style={{ height: mainHeight, width: '100%' }}>
            <QuickPanelProvider>
              <ChatNavbar
                activeAssistant={props.assistant}
                activeTopic={props.activeTopic}
                setActiveTopic={props.setActiveTopic}
                setActiveAssistant={props.setActiveAssistant}
                position="left"
              />
              <div
                className="flex flex-1 flex-col justify-between"
                style={{ height: `calc(${mainHeight} - var(--navbar-height))` }}>
                {/*
                  S6': BranchAnchorContext tints the source message block in
                  the main conversation while a branch is open. Provider scope
                  is just <Messages> — MainTextBlock is the only reader.
                */}
                <BranchAnchorContext value={branchAnchorHighlight}>
                  <Messages
                    key={props.activeTopic.id}
                    assistant={assistant}
                    topic={props.activeTopic}
                    setActiveTopic={props.setActiveTopic}
                    onOpenBranchAnchor={openBranchAnchor}
                    onComponentUpdate={messagesComponentUpdateHandler}
                    onFirstUpdate={messagesComponentFirstUpdateHandler}
                  />
                </BranchAnchorContext>
                <ContentSearch
                  ref={contentSearchRef}
                  searchTarget={mainRef as React.RefObject<HTMLElement>}
                  filter={contentSearchFilter}
                  includeUser={filterIncludeUser}
                  onIncludeUserChange={userOutlinedItemClickHandler}
                />
                {messageNavigation === 'buttons' && <ChatNavigation containerId="messages" />}
                <Inputbar assistant={assistant} setActiveTopic={props.setActiveTopic} topic={props.activeTopic} />
                {isMultiSelectMode && <MultiSelectActionPopup topic={props.activeTopic} />}
              </div>
            </QuickPanelProvider>
          </Main>
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
              <Tabs
                activeAssistant={assistant}
                activeTopic={props.activeTopic}
                setActiveAssistant={props.setActiveAssistant}
                setActiveTopic={props.setActiveTopic}
                position="right"
              />
            </motion.div>
          )}
        </AnimatePresence>
        {/*
          T-006D-2B side-by-side branch pane. Mirrors the right-Tabs motion
          pattern above. Width/opacity animate; the inner content is rendered
          unconditionally so the slide-out doesn't snap to empty.

          The Provider scope is intentionally limited to <BranchPane> — the
          main chat is outside this subtree, so its useAssistant() lookups
          see `null` from useContext and keep their original Redux behaviour
          bit-for-bit identical.
        */}
        <BranchAssistantContext value={branchOverride}>
          <BranchPane
            anchor={composerAnchor}
            branchTopic={activeBranchTopic}
            status={branchFork.status}
            errorMessage={branchFork.errorMessage}
            onCreate={(followUp) => {
              if (composerAnchor) void branchFork.fork(composerAnchor, followUp)
            }}
            onComposeCancel={() => {
              // Universal close path — works in compose state AND conversation
              // state. Order: (1) targeted clearSourceHighlight removes the
              // injected spans for THIS branch(es) synchronously (defense in
              // depth — the MainTextBlock effect cleanup will also run when
              // matchingAnchors flips to empty on the next render, but doing
              // it here makes the DOM clean BEFORE React commits the panel-
              // collapse, so there is no flash). S2a: per-branchId, so other
              // branches (none at S1, but future-proof at S2b) are untouched.
              // (2) setBranches([]) + setCollapsedBranchIds(new Set()) drives
              // `BranchPane`'s `isVisible` (derived from composerAnchor +
              // activeBranchTopic) to false (motion.div animates width → 0).
              // (3) branchFork.reset() returns the fork status to idle so the
              // next open starts clean. NOTE: this does NOT delete the forked
              // topic from SQLite — the row remains as an orphan until
              // T-006D-2C-5 cleanup ships path Y (delete-on-close).
              branches.forEach((b) => clearSourceHighlight(b.id))
              setBranches([])
              setCollapsedBranchIds(new Set())
              branchFork.reset()
            }}
          />
        </BranchAssistantContext>
      </RowFlex>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: calc(100vh - var(--navbar-height));
  flex: 1;
  overflow: hidden;
  [navbar-position='top'] & {
    height: calc(100vh - var(--navbar-height) - 6px);
    background-color: var(--color-background);
    border-top-left-radius: 10px;
    border-bottom-left-radius: 10px;
  }
`

const Main = styled(Flex)`
  [navbar-position='left'] & {
    height: calc(100vh - var(--navbar-height));
  }
  transform: translateZ(0);
  position: relative;
`

export default Chat
