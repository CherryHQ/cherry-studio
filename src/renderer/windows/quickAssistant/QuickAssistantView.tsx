import type { FC } from 'react'
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { usePreference } from '@data/hooks/usePreference'
import { MessageEditingProvider } from '@renderer/components/chat/editing/MessageEditingContext'
import NarrowLayout from '@renderer/components/chat/layout/NarrowLayout'
import { ChatConversationControls } from '@renderer/components/composer/variants/chat/ChatConversationControls'
import {
  type ChatConversationControlsSnapshot,
  ChatPlacementComposer
} from '@renderer/components/composer/variants/ChatComposer'
import { useQuickPanel } from '@renderer/components/QuickPanel'
import { useAssistant, useAssistants } from '@renderer/hooks/useAssistant'
import { useProviders } from '@renderer/hooks/useProvider'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { isMac, isWin } from '@renderer/utils/platform'
import { cn } from '@renderer/utils/style'

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

/**
 * Whether a popover or dialog (pickers, response settings, MCP prompt arguments…) is open.
 * Keyed on Radix's `data-state`: kept-mounted pickers stay in the DOM while closed, and
 * tooltips report `delayed-open`/`instant-open` instead. Dialogs portal without a popper.
 */
const FLOATING_OVERLAY_SELECTOR = [
  '[data-radix-popper-content-wrapper] > [data-state="open"]',
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]'
].join(', ')

const isFloatingOverlayOpen = () => document.querySelector(FLOATING_OVERLAY_SELECTOR) !== null

function useFloatingOverlayOpen(): boolean {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const update = () => setOpen(isFloatingOverlayOpen())
    const observer = new MutationObserver(update)
    observer.observe(document.body, { childList: true, subtree: true, attributeFilter: ['data-state'] })
    update()
    return () => observer.disconnect()
  }, [])
  return open
}

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
  const rootRef = useRef<HTMLDivElement>(null)
  const floatingOverlayOpen = useFloatingOverlayOpen()

  // The bar carries its own assistant picker, so there is no model-only mode to fall back
  // to — an install that has never picked one starts on the first assistant, exactly like
  // a new topic in the main window.
  const { assistants } = useAssistants()
  const activeAssistantId = assistantId || assistants[0]?.id || null
  const composerContext = useAssistant(activeAssistantId, { loadDefaultModel: true })
  const { assistant } = composerContext
  const activeConversationControlsSnapshot =
    conversationControlsSnapshot?.scopeKey === COMPOSER_SCOPE_KEY ? conversationControlsSnapshot : null
  const shouldLoadProviders = Boolean(
    activeConversationControlsSnapshot &&
    (activeConversationControlsSnapshot.mentionedModels.length > 1 ||
      activeConversationControlsSnapshot.mentionedModelSelectorValue.length > 1 ||
      activeConversationControlsSnapshot.lockedMentionedModels.length > 1)
  )
  const { providers } = useProviders(undefined, { enabled: shouldLoadProviders })
  const conversation = useQuickConversation({ assistantId: activeAssistantId ?? undefined })
  const { topic, topicId, isLoading, isSaving, error, send, stop, reset, save } = conversation

  // Wraps setState with an eager IPC call so main's pin flag is updated
  // synchronously inside the click handler — a useEffect-based sync would
  // defer IPC by at least one render, opening a race where blur fires with
  // the main flag still stale.
  const setIsPinned = useCallback((next: boolean) => {
    void ipcApi.request('quick_assistant.set_pin', { isPinned: next })
    setIsPinnedState(next)
  }, [])

  const windowView: QuickWindowView =
    view === 'panel' ? 'panel' : quickPanel.isVisible || floatingOverlayOpen ? 'quick-panel' : 'bar'
  const lastWindowSizeRef = useRef<{ view: QuickWindowView; contentHeight: number } | null>(null)

  const applyViewHeight = useCallback((next: QuickWindowView, barHeight: number) => {
    // Transparent windows keep headroom so menus never move the native window under the composer.
    const contentHeight = next === 'bar' && !isMac && !isWin ? barHeight : PANEL_HEIGHT_PX
    const previous = lastWindowSizeRef.current
    if (previous?.view === next && previous.contentHeight === contentHeight) return
    lastWindowSizeRef.current = { view: next, contentHeight }
    void ipcApi.request('quick_assistant.set_view', {
      view: next,
      contentHeight,
      // A tweened grow repaints the bottom-anchored composer a step behind each move.
      animate: !prefersReducedMotion() && next !== 'quick-panel' && previous?.view !== 'quick-panel'
    })
  }, [])

  // Only the transparent headroom may let clicks through; cards and popovers stay interactive.
  useEffect(() => {
    if ((!isMac && !isWin) || view === 'panel') return
    let passThrough: boolean | null = null
    const apply = (next: boolean) => {
      if (next === passThrough) return
      passThrough = next
      void ipcApi.request('quick_assistant.set_pointer_passthrough', { passThrough: next })
    }
    const onMouseMove = (event: MouseEvent) => apply(event.target === rootRef.current)
    document.addEventListener('mousemove', onMouseMove)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      apply(false)
    }
  }, [view])

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

  // A saved conversation belongs to the main window from here on; continuing it in this
  // temporary surface would bypass its branch anchor and tool-approval flow.
  const handlePersist = useCallback(async () => {
    if (!(await save())) return
    toast.success(t('quickAssistant.control_bar.saved'))
    collapse()
  }, [collapse, save, t])

  const handlePause = useCallback(() => void stop(), [stop])

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
    // An open popover owns Escape. Sampled ahead of Radix's document-capture dismiss, which
    // has closed it by the bubble phase; `defaultPrevented` can't tell either, since a
    // closed kept-mounted picker still prevents every Escape.
    let popoverOwnsEscape = false
    const onKeyDownCapture = (event: KeyboardEvent) => {
      if (event.key === 'Escape') popoverOwnsEscape = isFloatingOverlayOpen()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !popoverOwnsEscape) handleEsc()
    }
    window.addEventListener('keydown', onKeyDownCapture, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDownCapture, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [handleEsc])

  useIpcOn('quick_assistant.shown', () => {
    // `part:composer-input` marks a plain wrapper in the runtime editor — focusing it is
    // a no-op. The caret belongs in the contenteditable Tiptap renders inside.
    const frame = barRef.current?.querySelector<HTMLElement>('[data-ui~="part:composer-input"]')
    ;(frame?.querySelector<HTMLElement>('[contenteditable="true"]') ?? frame)?.focus()
  })

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
      // Returned so the composer keeps a draft or queued follow-up that was not taken.
      const sent = send(text, options)
      if (sent) setView('panel')
      return sent
    },
    [send]
  )

  const handleAssistantChange = useCallback(
    async (nextId: string | null) => {
      if (!nextId) return
      // Collapse first: the preference update is optimistic, so awaiting it renders the
      // new assistant against the outgoing conversation for a frame before the reset.
      collapse()
      await setAssistantId(nextId)
    },
    [collapse, setAssistantId]
  )

  const renderConversationControls = (side: 'top' | 'bottom') => (
    <ChatConversationControls
      assistantId={assistant?.id ?? null}
      assistantName={assistant?.name ?? t('button.select_assistant')}
      assistantEmoji={assistant?.emoji}
      model={composerContext.model}
      modelPending={composerContext.isLoading || composerContext.isModelPending || !activeConversationControlsSnapshot}
      providers={providers}
      mentionedModels={activeConversationControlsSnapshot?.mentionedModels ?? EMPTY_MODELS}
      mentionedModelSelectorValue={
        activeConversationControlsSnapshot?.mentionedModelSelectorValue ??
        (composerContext.model ? [composerContext.model] : EMPTY_MODELS)
      }
      lockedMentionedModels={activeConversationControlsSnapshot?.lockedMentionedModels ?? EMPTY_MODELS}
      mentionedModelMultiSelectMode={activeConversationControlsSnapshot?.mentionedModelMultiSelectMode ?? false}
      selectModelLabel={composerContext.isModelPending ? t('common.loading') : t('button.select_model')}
      // Single-model selector on purpose: TemporaryChatContextProvider answers only
      // `mentionedModelIds[0]`, so a multi-select here would drop every model after the
      // first with nothing but a main-process warning to show for it.
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
        ref={rootRef}
        data-ui="quick-assistant.view"
        className={cn(
          'flex h-full w-full flex-col overflow-hidden',
          view === 'bar' && 'justify-end',
          view === 'panel'
            ? 'rounded-[20px] bg-card text-card-foreground'
            : isMac || isWin
              ? 'bg-transparent'
              : 'bg-popover text-popover-foreground',
          draggable ? '[-webkit-app-region:drag]' : '[-webkit-app-region:no-drag]'
        )}>
        {view === 'panel' && (
          <>
            <ControlBar
              loading={isLoading}
              isPinned={isPinned}
              topicId={topicId}
              topicTitle={topic.name || t('settings.quickAssistant.title')}
              onEsc={handleEsc}
              onSetPinned={setIsPinned}
              onPersist={handlePersist}
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

        {error && (
          <div
            role="alert"
            className="mx-2 mb-2 break-all rounded-lg border border-error-border bg-error-subtle px-3 py-2 text-[13px] text-error-subtle-foreground [-webkit-app-region:no-drag]">
            {error}
          </div>
        )}

        <div
          ref={barRef}
          data-ui="quick-assistant.composer"
          className={cn('[-webkit-app-region:no-drag]', view === 'panel' && 'pb-2')}
          onFocusCapture={(event) => {
            const input = event.currentTarget.querySelector('[data-ui~="part:composer-input"]')
            if (input?.contains(event.target)) setComposerEngaged(true)
          }}>
          {view === 'panel' ? (
            <ChatPlacementComposer
              placement="docked"
              scope={COMPOSER_SCOPE_KEY}
              scopeKey={COMPOSER_SCOPE_KEY}
              topicId={topicId ?? undefined}
              assistantId={activeAssistantId ?? undefined}
              resolvedContext={composerContext}
              resolvedProviders={providers}
              externalContextControls
              sendDisabled={!topicId || isSaving}
              steerWhileBusy={false}
              onPause={handlePause}
              onConversationControlsChange={setConversationControlsSnapshot}
              onSend={handleSend}
            />
          ) : (
            <ChatPlacementComposer
              placement="home"
              scope={COMPOSER_SCOPE_KEY}
              scopeKey={COMPOSER_SCOPE_KEY}
              topicId={topicId ?? undefined}
              assistantId={activeAssistantId ?? undefined}
              resolvedContext={composerContext}
              resolvedProviders={providers}
              // Always external: the built-in context row brings a `bg-muted` backdrop
              // plate sized for a page behind it, which in a transparent frameless window
              // reads as a second window edge around the composer card.
              externalContextControls
              sendDisabled={!topicId || isSaving}
              steerWhileBusy={false}
              onPause={handlePause}
              onConversationControlsChange={setConversationControlsSnapshot}
              onSend={handleSend}
              onDraftAssistantChange={handleAssistantChange}
              compactWhenSingleLine={!composerEngaged}
            />
          )}
          {view === 'bar' &&
            composerEngaged && (
              // The card's own layout box, so the row lines up with it at any window width; px-2
              // matches the card toolbar's inset.
              <NarrowLayout narrowMode withSidePadding>
                <div
                  data-ui="quick-assistant.contextbar"
                  // The bar's only grip: the composer card is no-drag and the rest is headroom.
                  className="flex h-10 items-center gap-1.5 overflow-hidden px-2 [-webkit-app-region:drag] [&_button]:h-7 [&_button]:px-1.5 [&_button]:[-webkit-app-region:no-drag]">
                  {renderConversationControls('top')}
                </div>
              </NarrowLayout>
            )}
        </div>
      </div>
    </MessageEditingProvider>
  )
}

export default QuickAssistantView
