import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import NarrowLayout from '@renderer/components/chat/layout/NarrowLayout'
import SendMessageButton from '@renderer/components/SendMessageButton'
import { toast } from '@renderer/services/toast'
import { matchesComposerShortcut, resolveNewlineShortcut, resolveSendShortcut } from '@renderer/utils/input'
import { CirclePause } from 'lucide-react'
import {
  type ComponentType,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

import { getComposerEditorMinHeight } from './composerSizing'
import type { ComposerDeferredIntent, ComposerSurfaceActions, ComposerSurfaceProps } from './ComposerSurfaceRuntime'
import type { ComposerSerializedDraft, ComposerSerializedToken } from './tokens'

const COMPOSER_SIDE_PADDING_PX = 24

const logger = loggerService.withContext('ComposerSurface')

export type {
  ComposerDeferredIntent,
  ComposerSurfaceActions,
  ComposerSurfaceEditingState,
  ComposerSurfaceProps
} from './ComposerSurfaceRuntime'

let runtimePromise: Promise<{ default: ComponentType<ComposerSurfaceProps> }> | undefined

function loadRuntime() {
  runtimePromise ??= import('./ComposerSurfaceRuntime').catch((error) => {
    // Drop the rejected promise so the next interaction retries instead of replaying the failure.
    runtimePromise = undefined
    logger.error('Failed to load composer runtime', error as Error)
    throw error
  })
  return runtimePromise
}

/** Clipboard/drag payloads are only readable during their own event, so keep an owned copy. */
function cloneTransfer(source: DataTransfer | null): DataTransfer | undefined {
  if (!source) return undefined
  const clone = new DataTransfer()
  for (const type of source.types) {
    if (type !== 'Files') clone.setData(type, source.getData(type))
  }
  for (const file of source.files) clone.items.add(file)
  return clone
}

function DeferredComposerSurface(props: ComposerSurfaceProps) {
  const { t } = useTranslation()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const selectionRef = useRef({ start: props.text.length, end: props.text.length })
  const intentRef = useRef<ComposerDeferredIntent>({})
  const [preferredSendMessageShortcut] = usePreference('chat.input.send_message_shortcut')
  const sendMessageShortcut = props.sendMessageShortcut ?? resolveSendShortcut(preferredSendMessageShortcut)
  const [preferredNewlineShortcut] = usePreference('chat.input.newline_shortcut')
  const newlineShortcut = resolveNewlineShortcut(preferredNewlineShortcut, sendMessageShortcut)
  const [Runtime, setRuntime] = useState<ComponentType<ComposerSurfaceProps>>()
  const [runtimeReady, setRuntimeReady] = useState(false)
  const [isComposing, setIsComposing] = useState(false)
  const sendBlockedReasonRef = useRef(props.sendBlockedReason)

  useEffect(() => {
    sendBlockedReasonRef.current = props.sendBlockedReason
  }, [props.sendBlockedReason])

  const showBlockedSendReason = useCallback(() => {
    if (sendBlockedReasonRef.current) {
      toast.error(sendBlockedReasonRef.current)
    }
  }, [])

  const requestRuntime = useCallback(() => {
    void loadRuntime()
      .then((module) => {
        setRuntime(() => module.default)
        setRuntimeReady(true)
      })
      .catch(() => {
        // Already logged; the fallback stays usable and a later interaction retries.
      })
  }, [])

  const getFallbackDraft = useCallback(
    (): ComposerSerializedDraft => ({
      text: props.text,
      tokens: props.draftTokens?.length
        ? [...props.draftTokens]
        : props.tokens.map((token, index) => ({ ...token, index, textOffset: props.text.length }))
    }),
    [props.draftTokens, props.text, props.tokens]
  )

  // The fallback cannot rebase token offsets or render the editing header, so hand those states
  // straight to the runtime instead of serving them badly.
  const needsRuntime = Boolean(props.editingState) || Boolean(props.draftTokens?.length)
  useEffect(() => {
    if (needsRuntime) requestRuntime()
  }, [needsRuntime, requestRuntime])

  // Swap while the app is idle rather than under the user's first keystroke: a swap that lands
  // between a keydown and its character insertion drops that character, and no hand-off inside
  // the runtime can recover it. Idle work stays off the first-paint path this fallback protects.
  useEffect(() => {
    if (Runtime || !window.requestIdleCallback) return
    const idleId = window.requestIdleCallback(() => requestRuntime())
    return () => window.cancelIdleCallback(idleId)
  }, [Runtime, requestRuntime])

  useEffect(() => {
    if (Runtime || !props.onActionsChange) return

    const updateText = (updater: string | ((previous: string) => string)) => {
      props.onTextChange(typeof updater === 'function' ? updater(props.text) : updater)
    }
    const updateTokens = (tokens: readonly ComposerSerializedToken[]) => props.onTokensChange(tokens)

    const actions: ComposerSurfaceActions = {
      focus: (position) => {
        const input = textareaRef.current
        if (!input) return
        input.focus()
        const nextPosition =
          typeof position === 'number'
            ? position
            : position === 'start'
              ? 0
              : position === 'all'
                ? undefined
                : input.value.length
        input.setSelectionRange(nextPosition ?? 0, nextPosition ?? input.value.length)
      },
      onTextChange: updateText,
      replaceDraft: (draft) => {
        selectionRef.current = { start: draft.text.length, end: draft.text.length }
        props.onTextChange(draft.text)
        updateTokens(draft.tokens)
      },
      toggleExpanded: (expanded) => props.onExpandedChange(expanded ?? !props.isExpanded),
      removeToken: (tokenId) => updateTokens((props.draftTokens ?? []).filter((token) => token.id !== tokenId)),
      // A token needs its prompt text woven into the document at the caret, which only the rich
      // editor can do; the whole range travels along so the runtime still replaces a selection.
      insertToken: (token) => {
        const input = textareaRef.current
        intentRef.current.insertToken = {
          token,
          selection: {
            start: input?.selectionStart ?? props.text.length,
            end: input?.selectionEnd ?? props.text.length
          }
        }
        requestRuntime()
      },
      getDraft: getFallbackDraft
    }

    props.onActionsChange(actions)
  }, [Runtime, getFallbackDraft, props, requestRuntime])

  if (Runtime && runtimeReady && !isComposing) {
    return <Runtime {...props} initialTextSelection={selectionRef.current} deferredIntent={intentRef.current} />
  }

  const updateSelection = () => {
    const input = textareaRef.current
    if (input) selectionRef.current = { start: input.selectionStart, end: input.selectionEnd }
  }

  const insertFallbackNewline = (input: HTMLTextAreaElement) => {
    input.setRangeText('\n', input.selectionStart, input.selectionEnd, 'end')
    selectionRef.current = { start: input.selectionStart, end: input.selectionEnd }
    props.onTextChange(input.value)
  }

  const captureTransfer = (kind: 'paste' | 'drop', data: DataTransfer | null) => {
    const transfer = cloneTransfer(data)
    if (transfer) intentRef.current.transfer = { kind, data: transfer }
    requestRuntime()
  }

  const navigateInputHistory = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (!props.onInputHistoryNavigate) return false
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return false
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.nativeEvent.isComposing) return false

    const input = event.currentTarget
    const isAllSelected =
      input.value.length > 0 && input.selectionStart === 0 && input.selectionEnd === input.value.length
    const isAtBoundary =
      event.key === 'ArrowUp' ? input.selectionStart === input.value.length : input.selectionEnd === input.value.length
    if (!(props.text.trim().length === 0 || isAllSelected || isAtBoundary)) return false

    return props.onInputHistoryNavigate(event.key === 'ArrowUp' ? 'up' : 'down')
  }

  // Keeps panel-backed toolbar controls (Skills, the "+" menu) rendered and remembers the panel the
  // user asked for; the runtime opens it as soon as it mounts.
  const pendingPanelControl = {
    available: props.quickPanelEnabled,
    open: (options?: { launcherId?: string; searchText?: string }) => {
      intentRef.current.openPanel = options ?? {}
      requestRuntime()
    }
  }
  const leftControls = props.renderLeftControls?.(undefined, pendingPanelControl)
  const belowControls = props.renderBelowControls?.(undefined, pendingPanelControl)
  const sendAccessoryElement = typeof props.sendAccessory === 'function' ? props.sendAccessory() : props.sendAccessory
  const editorMinHeight = getComposerEditorMinHeight(props.fontSize)
  const sendAction =
    props.isLoading && props.sendDisabled ? (
      <button
        data-ui="chat.composer.action.pause"
        type="button"
        className="flex size-7.5 items-center justify-center rounded-full text-error hover:bg-accent"
        aria-label={t('chat.input.pause')}
        onClick={() => void props.onPause()}>
        <CirclePause size={20} />
      </button>
    ) : (
      <SendMessageButton
        disabled={props.sendDisabled}
        sendMessage={() => void props.onSendDraft(getFallbackDraft())}
        onDisabledClick={showBlockedSendReason}
      />
    )
  const inputbarElement = (
    <div
      id="inputbar"
      data-ui="chat.composer"
      data-composer-inputbar=""
      data-composer-presentation="regular"
      className={`inputbar-container relative rounded-[20px] border-[0.5px] border-border bg-card pt-2 shadow-sm ${
        belowControls ? 'mb-0.5' : 'mb-3'
      }`}>
      {props.topContent}
      <div className={props.leadingContent ? 'flex items-start' : 'contents'}>
        {props.leadingContent ? <div className="shrink-0 pt-1.5 pl-3.5">{props.leadingContent}</div> : null}
        <textarea
          ref={textareaRef}
          aria-label={props.placeholder}
          value={props.text}
          placeholder={props.placeholder}
          rows={1}
          disabled={props.editable === false}
          spellCheck={props.enableSpellCheck}
          data-ui="part:composer-input"
          className="box-border block w-full min-w-0 flex-1 resize-none overflow-auto bg-transparent text-foreground outline-none"
          style={{
            height: editorMinHeight,
            minHeight: editorMinHeight,
            padding: '6px 44px 0 15px',
            fontSize: props.fontSize,
            lineHeight: 1.4
          }}
          onChange={(event) => {
            updateSelection()
            props.onTextChange(event.currentTarget.value)
            requestRuntime()
          }}
          onFocus={() => {
            props.onFocus?.()
            // Start the rich runtime on focus, not on the first key: with a warm chunk the swap
            // would otherwise commit before the keystroke's input event, dropping the character.
            requestRuntime()
          }}
          onSelect={updateSelection}
          onPaste={(event) => {
            // Native insertion would keep only the plain text and drop files, HTML and token
            // fragments, so hand the whole payload to the runtime instead.
            event.preventDefault()
            captureTransfer('paste', event.clipboardData)
          }}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={(event) => {
            // Some IMEs only write the committed characters on compositionend, and the textarea is
            // about to unmount, so read the final value here rather than waiting for `change`.
            const input = event.currentTarget
            selectionRef.current = { start: input.selectionStart, end: input.selectionEnd }
            if (input.value !== props.text) props.onTextChange(input.value)
            setIsComposing(false)
          }}
          onKeyDown={(event) => {
            requestRuntime()
            if (navigateInputHistory(event)) {
              event.preventDefault()
              return
            }
            // Same priority order as the runtime surface, so the two never drift: steer wins over
            // send, and every other Enter combination is swallowed rather than inserting a break.
            const isEnterPressed =
              (event.key === 'Enter' || event.key === 'NumpadEnter') && !event.nativeEvent.isComposing
            if (!isEnterPressed) return

            event.preventDefault()

            const isSteerPressed = !!props.steerShortcut && matchesComposerShortcut(event, props.steerShortcut)
            if (isSteerPressed || matchesComposerShortcut(event, sendMessageShortcut)) {
              // Holding the key must not send twice; holding the newline key still repeats.
              if (event.repeat) return
              if (props.sendDisabled) {
                showBlockedSendReason()
              } else if (isSteerPressed) {
                void props.onSendDraft(getFallbackDraft(), { steer: true })
              } else {
                void props.onSendDraft(getFallbackDraft())
              }
              return
            }

            if (matchesComposerShortcut(event, newlineShortcut)) insertFallbackNewline(event.currentTarget)
          }}
        />
      </div>
      <div
        data-ui="part:composer-actions"
        data-composer-toolbar=""
        className="relative z-2 flex h-10 shrink-0 flex-row justify-between gap-4 px-2 py-1.25">
        <div className="flex min-w-0 flex-1 items-center overflow-hidden">{leftControls}</div>
        <div className="flex flex-row items-center gap-1.5">
          {sendAccessoryElement}
          {sendAction}
        </div>
      </div>
    </div>
  )

  const handleDragOver = props.enableDragDrop
    ? (event: ReactDragEvent<HTMLDivElement>) => {
        event.preventDefault()
        requestRuntime()
      }
    : undefined
  const handleDrop = props.enableDragDrop
    ? (event: ReactDragEvent<HTMLDivElement>) => {
        event.preventDefault()
        captureTransfer('drop', event.dataTransfer)
      }
    : undefined

  return (
    <NarrowLayout
      narrowMode={props.narrowMode}
      withSidePadding
      className="pointer-events-auto"
      style={{
        width: '100%',
        ...(props.railGutterPx != null
          ? {
              paddingLeft: COMPOSER_SIDE_PADDING_PX + props.railGutterPx,
              paddingRight: COMPOSER_SIDE_PADDING_PX + props.railGutterPx
            }
          : {})
      }}>
      <div className="w-full">
        <div className="inputbar relative z-2 flex flex-col pt-0" onDragOver={handleDragOver} onDrop={handleDrop}>
          {belowControls ? (
            <div className="mb-6 rounded-[20px] bg-muted/45 pb-1.5 dark:bg-muted/25">
              {props.queueContent}
              <div className="relative">{inputbarElement}</div>
              <div className="min-w-0 overflow-hidden px-2 pt-0.5">{belowControls}</div>
            </div>
          ) : (
            <>
              {props.queueContent}
              <div className="relative">{inputbarElement}</div>
            </>
          )}
        </div>
      </div>
    </NarrowLayout>
  )
}

export default DeferredComposerSurface
