import type { CSSProperties, MouseEventHandler } from 'react'
import { useLayoutEffect, useRef } from 'react'

import { ComposerToken } from '../tokens'
import type { PromptVariableComposerInputToken } from './tokens'

export type PromptVariableCommitReason = 'blur' | 'enter' | 'tab'

const promptVariableInputStyle = {
  minWidth: '2ch',
  maxWidth: '100%'
} as CSSProperties

function resizePromptVariableInput(input: HTMLTextAreaElement | null) {
  if (!input) return

  input.style.height = 'auto'
  if (input.scrollHeight > 0) input.style.height = `${input.scrollHeight}px`
}

export interface PromptVariableTokenProps {
  token: PromptVariableComposerInputToken
  selected?: boolean
  editing?: boolean
  className?: string
  onCommit?: (
    value: string,
    reason: PromptVariableCommitReason,
    options: { dirty: boolean; direction?: 1 | -1 }
  ) => void
  onSelectAll?: (value: string, options: { dirty: boolean }) => void
  onEditRequest?: () => void
}

export function PromptVariableToken({
  token,
  selected = false,
  editing = false,
  className,
  onCommit,
  onSelectAll,
  onEditRequest
}: PromptVariableTokenProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const isComposingRef = useRef(false)
  const isDirtyRef = useRef(false)
  const hasFinishedCurrentDraftRef = useRef(false)
  const activeEditTokenIdRef = useRef<string | null>(null)
  const onCommitRef = useRef(onCommit)
  const onSelectAllRef = useRef(onSelectAll)
  const isEditing = editing && !!onCommit

  onCommitRef.current = onCommit
  onSelectAllRef.current = onSelectAll

  useLayoutEffect(() => {
    if (!isEditing) {
      activeEditTokenIdRef.current = null
      isDirtyRef.current = false
      hasFinishedCurrentDraftRef.current = false
      return
    }

    const input = inputRef.current
    if (!input) return

    const handleCompositionStart = (event: Event) => {
      event.stopPropagation()
      isComposingRef.current = true
    }

    const handleCompositionEnd = (event: Event) => {
      event.stopPropagation()
      isComposingRef.current = false
      const compositionText = (event as CompositionEvent).data
      const nextValue = compositionText && input.value === token.label ? compositionText : input.value
      if (input.value !== nextValue) input.value = nextValue
      if (nextValue !== token.label) isDirtyRef.current = true
      resizePromptVariableInput(input)
    }

    const updateDraftState = () => {
      isDirtyRef.current = true
      hasFinishedCurrentDraftRef.current = false
      resizePromptVariableInput(input)
    }

    const finishEditing = (reason: PromptVariableCommitReason, options: { direction?: 1 | -1 } = {}) => {
      const nextValue = input.value
      const dirty = isDirtyRef.current || nextValue !== token.label
      if (!dirty && hasFinishedCurrentDraftRef.current) return

      onCommitRef.current?.(nextValue, reason, { dirty, ...options })
      isDirtyRef.current = false
      hasFinishedCurrentDraftRef.current = true
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || isComposingRef.current) return

      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        event.stopPropagation()
        onSelectAllRef.current?.(input.value, { dirty: isDirtyRef.current })
        isDirtyRef.current = false
        hasFinishedCurrentDraftRef.current = true
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        finishEditing('enter')
        input.blur()
        return
      }

      if (event.key === 'Tab') {
        event.preventDefault()
        event.stopPropagation()
        finishEditing('tab', { direction: event.shiftKey ? -1 : 1 })
      }
    }

    const handleBlur = () => {
      finishEditing('blur')
    }

    input.addEventListener('compositionstart', handleCompositionStart)
    input.addEventListener('compositionend', handleCompositionEnd)
    input.addEventListener('input', updateDraftState)
    input.addEventListener('change', updateDraftState)
    input.addEventListener('keydown', handleKeyDown)
    input.addEventListener('blur', handleBlur)

    let focusFrame: number | undefined
    if (activeEditTokenIdRef.current !== token.id) {
      activeEditTokenIdRef.current = token.id
      isDirtyRef.current = false
      hasFinishedCurrentDraftRef.current = false
      input.focus({ preventScroll: true })
      input.select()
      resizePromptVariableInput(input)
      focusFrame = window.requestAnimationFrame(() => {
        input.focus({ preventScroll: true })
        input.select()
        resizePromptVariableInput(input)
      })
    }

    return () => {
      if (focusFrame !== undefined) window.cancelAnimationFrame(focusFrame)
      input.removeEventListener('compositionstart', handleCompositionStart)
      input.removeEventListener('compositionend', handleCompositionEnd)
      input.removeEventListener('input', updateDraftState)
      input.removeEventListener('change', updateDraftState)
      input.removeEventListener('keydown', handleKeyDown)
      input.removeEventListener('blur', handleBlur)
    }
  }, [isEditing, token.id, token.label])

  const handleInputChange = () => {
    isDirtyRef.current = true
    hasFinishedCurrentDraftRef.current = false
    resizePromptVariableInput(inputRef.current)
  }
  const handleTokenMouseDown: MouseEventHandler<HTMLSpanElement> | undefined =
    !isEditing && onEditRequest
      ? (event) => {
          event.preventDefault()
          event.stopPropagation()
          onEditRequest()
        }
      : undefined

  return (
    <ComposerToken
      token={token}
      selected={selected}
      className={className}
      maxWidthClassName="max-w-full"
      onMouseDown={handleTokenMouseDown}>
      {isEditing ? (
        <textarea
          ref={inputRef}
          defaultValue={token.label}
          aria-label={token.description ?? token.label}
          rows={1}
          className="field-sizing-content wrap-anywhere m-0 min-w-0 max-w-full resize-none overflow-hidden whitespace-pre-wrap border-0 bg-transparent p-0 font-[inherit] text-current leading-[inherit] outline-none"
          style={promptVariableInputStyle}
          onChange={handleInputChange}
          onMouseDown={(event) => event.stopPropagation()}
        />
      ) : (
        <span className="wrap-anywhere min-w-0 whitespace-pre-wrap">{token.label}</span>
      )}
    </ComposerToken>
  )
}
