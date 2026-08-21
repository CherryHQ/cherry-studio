import { usePreference } from '@data/hooks/usePreference'
import { MessageEditingProvider } from '@renderer/components/chat/editing/MessageEditingContext'
import { ChatConversationControls } from '@renderer/components/composer/variants/chat/ChatConversationControls'
import {
  type ChatConversationControlsSnapshot,
  ChatPlacementComposer
} from '@renderer/components/composer/variants/ChatComposer'
import { useQuickPanel } from '@renderer/components/QuickPanel'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useProviders } from '@renderer/hooks/useProvider'
import { ipcApi } from '@renderer/ipc'
import { cn } from '@renderer/utils/style'
import type { FC } from 'react'
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ControlBar from './panel/ControlBar'
import { useQuickConversation } from './useQuickConversation'

// Lazy boundary (S6b): the panel carries the whole message rendering chain
// (MessageList, ChatMarkdown, CodeMirror, katex, mermaid). The bar never renders it,
// so it stays out of the first paint and only loads once a conversation starts.
const QuickMessages = React.lazy(() => import('./panel/QuickMessages'))

/** Height of the expanded panel; main clamps it into the display's work area. */
const PANEL_HEIGHT_PX = 560
/** Stable across temporary-topic re-leases, so the draft survives switching assistant. */
const COMPOSER_SCOPE_KEY = 'quick-assistant'
const EMPTY_MODELS: ChatConversationControlsSnapshot['mentionedModels'] = []
const NOOP_MODEL_SELECT: ChatConversationControlsSnapshot['onModelSelect'] = () => undefined
const NOOP_MODELS_SELECT: ChatConversationControlsSnapshot['onMentionedModelsSelect'] = () => undefined
const NOOP_MULTI_SELECT_MODE_CHANGE: ChatConversationControlsSnapshot['onMentionedModelMultiSelectModeChange'] = () =>
  undefined
const NOOP_MODEL_SELECTOR_RESTORE: ChatConversationControlsSnapshot['onMentionedModelSelectorRestore'] = () => undefined

type QuickView = 'bar' | 'panel'
type QuickWindowView = QuickView | 'quick-panel'

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

const QuickAssistantView: FC<{ draggable?: boolean }> = ({ draggable = true }) => {
  const { t } = useTranslation()
  const [assistantId, setAssistantId] = usePreference('feature.quick_assistant.assistant_id')
  const quickPanel = useQuickPanel()

  const [view, setView] = useState<QuickView>('bar')
  const [composerEngaged, setComposerEngaged] = useState(false)
  const [isPinned, setIsPinnedState] = useState(false)
  const [conversationControlsSnapshot, setConversationControlsSnapshot] =
    useState<ChatConversationControlsSnapshot | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  const assistantContext = useAssistant(assistantId || null)
  const { assistant } = assistantContext
  const activeConversationControlsSnapshot =
    conversationControlsSnapshot?.scopeKey === COMPOSER_SCOPE_KEY ? conversationControlsSnapshot : null
  const shouldLoadProviders = Boolean(
    activeConversationControlsSnapshot &&
      (activeConversationControlsSnapshot.mentionedModels.length > 1 ||
        activeConversationControlsSnapshot.mentionedModelSelectorValue.length > 1 ||
        activeConversationControlsSnapshot.lockedMentionedModels.length > 1)
  )
  const { providers } = useProviders(undefined, { enabled: shouldLoadProviders })
  const conversation = useQuickConversation({ assistantId: assistantId || undefined })
  const { topic, topicId, isLoading, isSaved, error, send, stop, reset, save } = conversation

  // Wraps setState with an eager IPC call so main's pin flag is updated
  // synchronously inside the click handler — a useEffect-based sync would
  // defer IPC by at least one render, opening a race where blur fires with
  // the main flag still stale.
  const setIsPinned = useCallback((next: boolean) => {
    void ipcApi.request('quick_assistant.set_pin', { isPinned: next })
    setIsPinnedState(next)
  }, [])

  const windowView: QuickWindowView = view === 'panel' ? 'panel' : quickPanel.isVisible ? 'quick-panel' : 'bar'

  const applyViewHeight = useCallback((next: QuickWindowView, barHeight: number) => {
    void ipcApi.request('quick_assistant.set_view', {
      view: next,
      contentHeight: next === 'bar' ? barHeight : PANEL_HEIGHT_PX,
      animate: !prefersReducedMotion()
    })
  }, [])

  // The bar grows with the draft, so its height is measured rather than assumed.
  useEffect(() => {
    const element = barRef.current
    if (!element) return

    const observer = new ResizeObserver(() => applyViewHeight(windowView, element.offsetHeight))
    observer.observe(element)
    applyViewHeight(windowView, element.offsetHeight)
    return () => observer.disconnect()
  }, [applyViewHeight, windowView])

  const collapse = useCallback(() => {
    setComposerEngaged(false)
    setView('bar')
    reset()
  }, [reset])

  const handleCloseWindow = useCallback(() => ipcApi.request('quick_assistant.hide'), [])

  const handleEsc = useCallback(() => {
    if (isLoading) {
      void stop()
      return
    }
    if (view === 'panel') {
      collapse()
      return
    }
    void handleCloseWindow()
  }, [collapse, handleCloseWindow, isLoading, stop, view])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleEsc()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [handleEsc])

  useEffect(() => {
    const resetComposerWhileHidden = () => {
      if (!document.hidden) return
      setComposerEngaged(false)
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    }

    document.addEventListener('visibilitychange', resetComposerWhileHidden)
    resetComposerWhileHidden()
    return () => document.removeEventListener('visibilitychange', resetComposerWhileHidden)
  }, [])

  const handleSend = useCallback(
    (text: string, options?: Parameters<typeof send>[1]) => {
      // Only grow once the turn is actually under way — a send dropped because the
      // temporary topic lease has not landed yet would leave an empty panel behind.
      if (send(text, options)) setView('panel')
    },
    [send]
  )

  const handleAssistantChange = useCallback(
    async (nextId: string | null) => {
      if (!nextId) return
      // Re-leasing happens inside useTemporaryTopic when assistantId changes; dropping the
      // half-finished exchange first keeps the panel from mixing two assistants' turns.
      await setAssistantId(nextId)
      collapse()
    },
    [collapse, setAssistantId]
  )

  const renderConversationControls = (side: 'top' | 'bottom') => (
    <ChatConversationControls
      assistantId={assistant?.id ?? null}
      assistantName={assistant?.name ?? t('button.select_assistant')}
      assistantEmoji={assistant?.emoji}
      model={assistantContext.model}
      modelPending={
        assistantContext.isLoading || assistantContext.isModelPending || !activeConversationControlsSnapshot
      }
      providers={providers}
      mentionedModels={activeConversationControlsSnapshot?.mentionedModels ?? EMPTY_MODELS}
      mentionedModelSelectorValue={
        activeConversationControlsSnapshot?.mentionedModelSelectorValue ??
        (assistantContext.model ? [assistantContext.model] : EMPTY_MODELS)
      }
      lockedMentionedModels={activeConversationControlsSnapshot?.lockedMentionedModels ?? EMPTY_MODELS}
      mentionedModelMultiSelectMode={activeConversationControlsSnapshot?.mentionedModelMultiSelectMode ?? false}
      selectModelLabel={assistantContext.isModelPending ? t('common.loading') : t('button.select_model')}
      useMentionedModelSelector
      shouldAutoSelectCreatedAssistant={false}
      side={side}
      onAssistantChange={handleAssistantChange}
      onModelSelect={activeConversationControlsSnapshot?.onModelSelect ?? NOOP_MODEL_SELECT}
      onMentionedModelsSelect={activeConversationControlsSnapshot?.onMentionedModelsSelect ?? NOOP_MODELS_SELECT}
      onMentionedModelMultiSelectModeChange={
        activeConversationControlsSnapshot?.onMentionedModelMultiSelectModeChange ?? NOOP_MULTI_SELECT_MODE_CHANGE
      }
      onMentionedModelSelectorRestore={
        activeConversationControlsSnapshot?.onMentionedModelSelectorRestore ?? NOOP_MODEL_SELECTOR_RESTORE
      }
    />
  )

  return (
    <MessageEditingProvider>
      <div
        data-ui="quick-assistant.view"
        className={cn(
          'flex h-full w-full flex-col overflow-hidden',
          view === 'bar' && 'justify-end',
          view === 'panel' ? 'rounded-[20px] bg-card text-card-foreground' : 'bg-transparent',
          draggable ? '[-webkit-app-region:drag]' : '[-webkit-app-region:no-drag]'
        )}>
        {view === 'panel' && (
          <>
            <ControlBar
              loading={isLoading}
              isPinned={isPinned}
              isSaved={isSaved}
              topicId={topicId}
              topicTitle={topic.name || t('settings.quickAssistant.title')}
              onEsc={handleEsc}
              onSetPinned={setIsPinned}
              onPersist={save}
            />
            <div
              data-ui="quick-assistant.contextbar"
              className="flex h-10 shrink-0 items-center gap-1.5 overflow-hidden px-5 [-webkit-app-region:no-drag] [&_button]:h-7 [&_button]:px-1.5">
              {renderConversationControls('bottom')}
            </div>
          </>
        )}

        {view === 'panel' && (
          <div className="min-h-0 flex-1 [-webkit-app-region:no-drag]">
            <Suspense fallback={null}>
              <QuickMessages
                topic={topic}
                assistant={assistant}
                messages={conversation.messages}
                partsByMessageId={conversation.partsByMessageId}
              />
            </Suspense>
          </div>
        )}

        {error && view === 'bar' && (
          <div className="mb-2 break-all rounded border border-error-border bg-error-subtle px-3 py-2 text-[13px] text-error-subtle-foreground">
            {error}
          </div>
        )}

        <div
          ref={barRef}
          data-ui="quick-assistant.composer"
          className={cn('[-webkit-app-region:no-drag]', view === 'panel' && 'pb-2')}
          onFocusCapture={(event) => {
            const input = event.currentTarget.querySelector('[data-ui~="part:composer-input"]')
            if (input?.contains(event.target as Node)) setComposerEngaged(true)
          }}>
          {view === 'panel' ? (
            <ChatPlacementComposer
              placement="docked"
              scope={COMPOSER_SCOPE_KEY}
              scopeKey={COMPOSER_SCOPE_KEY}
              topicId={topicId ?? undefined}
              assistantId={assistantId || undefined}
              resolvedContext={assistantContext}
              resolvedProviders={providers}
              externalContextControls
              onConversationControlsChange={setConversationControlsSnapshot}
              onSend={handleSend}
            />
          ) : (
            <ChatPlacementComposer
              placement="home"
              scope={COMPOSER_SCOPE_KEY}
              scopeKey={COMPOSER_SCOPE_KEY}
              topicId={topicId ?? undefined}
              assistantId={assistantId || undefined}
              resolvedContext={assistantContext}
              resolvedProviders={providers}
              externalContextControls={composerEngaged}
              onConversationControlsChange={setConversationControlsSnapshot}
              onSend={handleSend}
              onDraftAssistantChange={handleAssistantChange}
              compactWhenSingleLine={!composerEngaged}
            />
          )}
          {view === 'bar' && composerEngaged && (
            <div
              data-ui="quick-assistant.contextbar"
              className="-mt-8 mx-6 overflow-hidden rounded-b-[20px] bg-card text-card-foreground">
              <div className="flex h-[60px] items-center gap-1.5 overflow-hidden rounded-b-[inherit] bg-muted px-2 pt-5 [&_button]:h-7 [&_button]:px-1.5">
                {renderConversationControls('top')}
              </div>
            </div>
          )}
        </div>
      </div>
    </MessageEditingProvider>
  )
}

export default QuickAssistantView
