import NarrowLayout from '@renderer/components/chat/layout/NarrowLayout'
import SendMessageButton from '@renderer/components/SendMessageButton'
import type { SendMessageShortcut } from '@shared/data/preference/preferenceTypes'
import { CirclePause } from 'lucide-react'
import {
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'

import { getComposerEditorMinHeight } from './composerSizing'
import type { ComposerSurfaceActions, ComposerSurfaceProps } from './ComposerSurfaceRuntime'
import type { ComposerSerializedDraft, ComposerSerializedToken } from './tokens'

const COMPOSER_SIDE_PADDING_PX = 24

export type {
  ComposerSurfaceActions,
  ComposerSurfaceEditingState,
  ComposerSurfaceProps
} from './ComposerSurfaceRuntime'

let runtimePromise: Promise<{ default: ComponentType<ComposerSurfaceProps> }> | undefined

function loadRuntime() {
  runtimePromise ??= import('./ComposerSurfaceRuntime')
  return runtimePromise
}

function isSendShortcut(event: ReactKeyboardEvent<HTMLTextAreaElement>, shortcut: SendMessageShortcut) {
  if (event.key !== 'Enter' && event.key !== 'NumpadEnter') return false
  if (event.nativeEvent.isComposing) return false

  switch (shortcut) {
    case 'Enter':
      return !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey
    case 'Ctrl+Enter':
      return event.ctrlKey && !event.shiftKey && !event.metaKey && !event.altKey
    case 'Command+Enter':
      return event.metaKey && !event.shiftKey && !event.ctrlKey && !event.altKey
    case 'Alt+Enter':
      return event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey
    case 'Shift+Enter':
      return event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey
  }
}

function DeferredComposerSurface(props: ComposerSurfaceProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const selectionRef = useRef({ start: props.text.length, end: props.text.length })
  const [Runtime, setRuntime] = useState<ComponentType<ComposerSurfaceProps>>()
  const [runtimeReady, setRuntimeReady] = useState(false)
  const [isComposing, setIsComposing] = useState(false)

  const requestRuntime = useCallback(() => {
    void loadRuntime().then((module) => {
      setRuntime(() => module.default)
      setRuntimeReady(true)
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
        props.onTextChange(draft.text)
        updateTokens(draft.tokens)
      },
      toggleExpanded: (expanded) => props.onExpandedChange(expanded ?? !props.isExpanded),
      removeToken: (tokenId) => updateTokens((props.draftTokens ?? []).filter((token) => token.id !== tokenId)),
      insertToken: (token) => {
        const nextToken: ComposerSerializedToken = {
          ...token,
          index: props.draftTokens?.length ?? 0,
          textOffset: textareaRef.current?.selectionStart ?? props.text.length
        }
        updateTokens([...(props.draftTokens ?? []), nextToken])
      },
      getDraft: getFallbackDraft
    }

    props.onActionsChange(actions)
  }, [Runtime, getFallbackDraft, props, requestRuntime])

  if (Runtime && runtimeReady && !isComposing) {
    return <Runtime {...props} initialTextSelection={selectionRef.current} />
  }

  const updateSelection = () => {
    const input = textareaRef.current
    if (input) selectionRef.current = { start: input.selectionStart, end: input.selectionEnd }
  }

  const leftControls = props.renderLeftControls?.()
  const belowControls = props.renderBelowControls?.()
  const sendAccessoryElement = typeof props.sendAccessory === 'function' ? props.sendAccessory() : props.sendAccessory
  const editorMinHeight = getComposerEditorMinHeight(props.fontSize)
  const sendAction =
    props.isLoading && props.sendDisabled ? (
      <button
        data-ui="chat.composer.action.pause"
        type="button"
        className="flex size-7.5 items-center justify-center rounded-full text-error hover:bg-accent"
        onClick={() => void props.onPause()}>
        <CirclePause size={20} />
      </button>
    ) : (
      <SendMessageButton disabled={props.sendDisabled} sendMessage={() => void props.onSendDraft(getFallbackDraft())} />
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
          }}
          onSelect={updateSelection}
          onPaste={requestRuntime}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={(event) => {
            selectionRef.current = {
              start: event.currentTarget.selectionStart,
              end: event.currentTarget.selectionEnd
            }
            setIsComposing(false)
          }}
          onKeyDown={(event) => {
            requestRuntime()
            if (!isSendShortcut(event, props.sendMessageShortcut ?? 'Enter')) return
            event.preventDefault()
            if (!event.repeat && !props.sendDisabled) void props.onSendDraft(getFallbackDraft())
          }}
        />
      </div>
      <div
        data-ui="part:composer-actions"
        data-composer-toolbar=""
        className="relative z-2 flex h-10 shrink-0 flex-row justify-between gap-4 px-2 py-1.25"
        onPointerDown={requestRuntime}>
        <div className="flex min-w-0 flex-1 items-center overflow-hidden">{leftControls}</div>
        <div className="flex flex-row items-center gap-1.5">
          {sendAccessoryElement}
          {sendAction}
        </div>
      </div>
    </div>
  )

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
        <div className="inputbar relative z-2 flex flex-col pt-0">
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
