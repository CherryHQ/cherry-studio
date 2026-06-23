import { RowFlex } from '@cherrystudio/ui'
import { useMutation } from '@data/hooks/useDataApi'
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
import { useBranchFollowUp } from '@renderer/hooks/useBranchFollowUp'
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
import React, { useCallback, useMemo, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { v4 as uuidv4 } from 'uuid'

import ChatNavbar from './components/ChatNavBar'
import Inputbar from './Inputbar/Inputbar'
import { type Branch, type BranchAnchor, BranchPane, pickNextColor } from './Messages/BranchPanel'
import { abortBranchTopicStream } from './Messages/BranchPanel/abortBranchTopicStream'
import {
  DEFAULT_BRANCH_DISPOSITION,
  disposeBranchTopicOnClose,
  toggleDisposition
} from './Messages/BranchPanel/branchDisposition'
import { scheduleForkTopicDeletion } from './Messages/BranchPanel/scheduleForkTopicDeletion'
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
  // P1-S2d: the shared ancestor of BOTH the main-thread highlight spans
  // (inside <Messages>) and the branch cards (<BranchPane>). BranchPane attaches
  // its highlight→card event delegation here. Hover state lives in BranchPane,
  // NOT here, so hovering never re-renders the <Messages> subtree.
  const chatContainerRef = React.useRef<HTMLDivElement>(null)
  const contentSearchRef = React.useRef<ContentSearchRef>(null)
  const [filterIncludeUser, setFilterIncludeUser] = useState(false)

  // P1-S1 state foundation: the legacy `branchAnchor + branchTopic` pair is
  // generalized to a `branches[]` array. P1-S2b-1: invariant lifted —
  // branches.length can now be > 1 (append semantics). The list is the
  // single source of truth; per-branch derivations (anchors for highlight,
  // synthetic assistant.topics, BranchPane cards) iterate it.
  //
  // collapsedBranchIds (now consumed in S2b-1): set of branch ids whose
  // card body is currently hidden. New branches start expanded (not in
  // this set). X-button close drops the branch from both branches[] and
  // collapsedBranchIds.
  const [branches, setBranches] = useState<Branch[]>([])
  const [collapsedBranchIds, setCollapsedBranchIds] = useState<Set<string>>(() => new Set())

  // P1-S2b-1: track which branch's fork is currently in flight. useBranchFork
  // is a single global hook with one in-flight slot at a time; this ref +
  // mirror state tells `onCreated` which branch to attach the new topic to,
  // and tells BranchPane which card should show the 'creating'/'error'
  // status. The ref is the source of truth (closure-captured by onCreated);
  // the state is for UI re-render via Provider value.
  const creatingBranchIdRef = useRef<string | null>(null)
  const [creatingBranchId, setCreatingBranchId] = useState<string | null>(null)

  // P1-S2b-1: a fresh anchor APPENDS to branches (S1 replace semantics is
  // dropped). The new Branch starts with `topic: null` to mirror the
  // previous "anchor first, POST /topics later" two-phase timing. `color` is
  // the next palette key not in use by an open branch (pickNextColor).
  // `id` is client-generated (uuid v4) so it stays stable from emit through
  // topic-creation through close.
  const openBranchAnchor = useCallback((anchor: BranchAnchor) => {
    setBranches((prev) => [
      ...prev,
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
        color: pickNextColor(prev.map((b) => b.color)),
        // P1-S3: pending = closing silently deletes the fork topic; Keep opts out.
        disposition: DEFAULT_BRANCH_DISPOSITION
      }
    ])
  }, [])

  const branchFork = useBranchFork({
    assistant,
    topic: props.activeTopic,
    onCreated: useCallback((created: Topic) => {
      // P1-S2b-1: attach the new topic to the branch that initiated this
      // fork. Tracked via ref (closure-captured stably across renders) so
      // multiple concurrent compose-state branches don't fight for it.
      const id = creatingBranchIdRef.current
      if (id === null) return
      setBranches((prev) => prev.map((b) => (b.id === id ? { ...b, topic: created } : b)))
      creatingBranchIdRef.current = null
      setCreatingBranchId(null)
    }, [])
  })

  // P1-S2b-1: per-card onCreate. BranchPane forwards (branchId, followUp)
  // for the card that submitted; this builds the BranchAnchor that
  // useBranchFork.fork still expects (its API is outside the touch list)
  // and records which branch the fork belongs to so onCreated finds it.
  const handleCreateBranchFollowUp = useCallback(
    (branchId: string, followUp: string) => {
      const target = branches.find((b) => b.id === branchId)
      if (!target) return
      const anchorForFork: BranchAnchor = {
        messageId: target.source.messageId,
        blockId: target.source.blockId,
        selectedText: target.source.selectedText,
        selectionStart: target.source.offsets.start,
        selectionEnd: target.source.offsets.end
      }
      creatingBranchIdRef.current = branchId
      setCreatingBranchId(branchId)
      void branchFork.fork(anchorForFork, followUp)
    },
    [branches, branchFork]
  )

  // P1-S2b-2: per-card follow-up send. Reuses the existing sendMessage thunk
  // (no POST /topics, no streaming-internal changes). `branchId` comes from the
  // card that submitted; we resolve it to that branch's own topic so a
  // follow-up in card B targets B's topic — never branches[0] or a global
  // "active" branch. Guard: a branch still in compose state (topic === null)
  // can't take a follow-up, so we no-op.
  const branchFollowUp = useBranchFollowUp({ assistant })
  const handleSendBranchFollowUp = useCallback(
    (branchId: string, followUp: string) => {
      const target = branches.find((b) => b.id === branchId)
      if (!target?.topic) return
      branchFollowUp.send(target.topic, followUp)
    },
    [branches, branchFollowUp]
  )

  // P1-S2b-1: collapse / expand a single branch's card body (chevron click).
  // Plain Set immutability — derive a new Set from prev so React re-renders.
  const toggleCollapsedBranchId = useCallback((branchId: string) => {
    setCollapsedBranchIds((prev) => {
      const next = new Set(prev)
      if (next.has(branchId)) {
        next.delete(branchId)
      } else {
        next.add(branchId)
      }
      return next
    })
  }, [])

  // P1-S2d: ensure a branch is expanded (used when its source highlight is
  // clicked). No-op if already expanded so we never collapse on click.
  const expandBranch = useCallback((branchId: string) => {
    setCollapsedBranchIds((prev) => {
      if (!prev.has(branchId)) return prev
      const next = new Set(prev)
      next.delete(branchId)
      return next
    })
  }, [])

  // P1-S3: reuse the existing DataApi `DELETE /topics/:id` (the same endpoint
  // useBranchFork's POST /topics created the fork on) to silently delete a
  // pending branch's fork topic on close. No Redux/Dexie internals touched.
  const { trigger: deleteForkTopic } = useMutation('DELETE', '/topics/:id', {
    refresh: ['/topics']
  })

  // P1-S3: Keep toggle (pending ↔ kept). Lifted like the other branch fields.
  const toggleKeepBranch = useCallback((branchId: string) => {
    setBranches((prev) =>
      prev.map((b) => (b.id === branchId ? { ...b, disposition: toggleDisposition(b.disposition) } : b))
    )
  }, [])

  // P1-S2b-1 + B5 + S3: per-branch close (X-button OR composer Cancel).
  // 0. P1-B5: abort this branch's in-flight streaming reply FIRST (capture the
  //    branch before we drop it). Runs regardless of disposition. Returns the
  //    aborted message ids (empty = non-streaming).
  // 0b. P1-S3: route by disposition — pending (default) DELETEs the fork topic
  //    (silently, via the existing DataApi DELETE /topics/:id); kept leaves it.
  //    P1-S3 delete-after-settle: when streaming was aborted, defer the delete
  //    until those messages' finalize lands (MESSAGE_COMPLETE) so it doesn't
  //    race the finalize PATCH → 404. Non-streaming deletes immediately.
  // 1. Targeted clear of THIS branch's highlight spans (S2a-targeted API).
  // 2. Drop from branches[] + collapsedBranchIds IMMEDIATELY (instant UX —
  //    the deferred delete only affects the DB row, not the panel).
  // 3. If the closed branch was the currently-creating one, reset fork state
  //    so a stale 'creating' / 'error' doesn't bleed into the next compose.
  const handleCloseBranch = useCallback(
    (branchId: string) => {
      const branch = branches.find((b) => b.id === branchId)
      const abortedMessageIds = branch?.topic ? abortBranchTopicStream(branch.topic.id) : []
      if (branch) {
        disposeBranchTopicOnClose(branch, (topicId) =>
          scheduleForkTopicDeletion(topicId, abortedMessageIds, (id) => void deleteForkTopic({ params: { id } }))
        )
      }
      clearSourceHighlight(branchId)
      setBranches((prev) => prev.filter((b) => b.id !== branchId))
      setCollapsedBranchIds((prev) => {
        if (!prev.has(branchId)) return prev
        const next = new Set(prev)
        next.delete(branchId)
        return next
      })
      if (creatingBranchIdRef.current === branchId) {
        creatingBranchIdRef.current = null
        setCreatingBranchId(null)
        branchFork.reset()
      }
    },
    [branches, branchFork, deleteForkTopic]
  )

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
    <Container
      ref={chatContainerRef}
      id="chat"
      className={classNames([messageStyle, { 'multi-select-mode': isMultiSelectMode }])}>
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
        {/*
          P1-S2b-1: BranchAssistantContext carries the synthetic assistant
          whose .topics now includes ALL open branch topics (each card's
          MessageGroup-level lookups by topicId find the right one).

          CRITICAL: BranchPane sits OUTSIDE BranchAnchorContext (which only
          wraps <Messages> above). Cards inside this pane render their own
          BranchMessageStream → MessageGroup → MainTextBlock; those
          MainTextBlocks read the default empty anchors list and therefore
          never paint highlights into branch-internal messages. That's the
          designed isolation that prevents cross-contamination of the source-
          passage highlight into branch conversations.
        */}
        <BranchAssistantContext value={branchOverride}>
          <BranchPane
            branches={branches}
            collapsedBranchIds={collapsedBranchIds}
            onToggleCollapsedBranchId={toggleCollapsedBranchId}
            creatingBranchId={creatingBranchId}
            forkStatus={branchFork.status}
            forkErrorMessage={branchFork.errorMessage}
            onCreate={handleCreateBranchFollowUp}
            onSendFollowUp={handleSendBranchFollowUp}
            onCloseBranch={handleCloseBranch}
            onToggleKeepBranch={toggleKeepBranch}
            containerRef={chatContainerRef}
            onExpandBranch={expandBranch}
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
