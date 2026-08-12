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

import type { ComposerSurfaceActions, ComposerSurfaceProps } from './ComposerSurfaceRuntime'
import type { ComposerSerializedDraft, ComposerSerializedToken } from './tokens'

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

  return (
    <div className="inputbar relative z-2 flex flex-col pt-0">
      <div
        id="inputbar"
        data-ui="chat.composer"
        data-composer-inputbar=""
        className="inputbar-container relative mb-3 rounded-[20px] border-[0.5px] border-border bg-card shadow-sm">
        {props.topContent}
        <textarea
          ref={textareaRef}
          aria-label={props.placeholder}
          value={props.text}
          placeholder={props.placeholder}
          disabled={!props.editable}
          spellCheck={props.enableSpellCheck}
          className="box-border block min-h-16 w-full resize-none overflow-auto rounded-[20px] bg-transparent px-4 py-3 pb-10 text-foreground outline-none"
          style={{ fontSize: props.fontSize }}
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
        <div data-ui="part:composer-actions" className="absolute right-3 bottom-2 flex items-center gap-1.5">
          {props.isLoading && props.sendDisabled ? (
            <button
              data-ui="chat.composer.action.pause"
              type="button"
              className="flex size-7.5 items-center justify-center rounded-full text-error hover:bg-accent"
              onClick={() => void props.onPause()}>
              <CirclePause size={20} />
            </button>
          ) : (
            <SendMessageButton
              disabled={props.sendDisabled}
              sendMessage={() => void props.onSendDraft(getFallbackDraft())}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default DeferredComposerSurface
