import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Textarea } from '@cherrystudio/ui'
import { isMac } from '@renderer/utils/platform'
import { cn } from '@renderer/utils/style'

interface Props {
  onSubmit: (comment: string) => void
  onCancel: (reason: 'escape' | 'blur') => void
  /** Submitting with no text quotes the target without a comment. */
  allowEmpty?: boolean
  className?: string
}

/** A comment for the agent about part of a file: Cmd/Ctrl+Enter or the button submits, Escape or clicking away cancels. */
export default function FileCommentBox({ onSubmit, onCancel, allowEmpty = false, className }: Props) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  // Unmounting a focused field can still report a blur, which must not cancel after a submit.
  const closed = useRef(false)
  const finish = (close: () => void) => {
    if (closed.current) return
    closed.current = true
    close()
  }
  const comment = text.trim()
  const canSubmit = allowEmpty || comment.length > 0
  const submit = () => {
    if (canSubmit) finish(() => onSubmit(comment))
  }
  const label = t(
    allowEmpty ? 'agent.preview_pane.comment.placeholder_optional' : 'agent.preview_pane.comment.placeholder',
    {
      shortcut: isMac ? '⌘↵' : 'Ctrl+↵'
    }
  )
  // Pierre settles focus after its gutter pointer events, so take it on the next frame.
  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])
  return (
    <div
      className={cn('relative rounded-md', className)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.key !== 'Escape') return
        // Escape closes only the box, not the file pane around it.
        event.preventDefault()
        event.stopPropagation()
        finish(() => onCancel('escape'))
      }}
      onBlur={(event) => {
        // Tabbing to the button stays inside; switching windows keeps the draft for the user's return.
        if (event.currentTarget.contains(event.relatedTarget) || !document.hasFocus()) return
        finish(() => onCancel('blur'))
      }}>
      <Textarea.Input
        ref={input}
        rows={2}
        value={text}
        onValueChange={setText}
        placeholder={label}
        aria-label={label}
        className="min-h-16 resize-none px-3 pt-2 pb-10 font-sans text-sm"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            submit()
          }
        }}
      />
      <Button
        type="button"
        size="sm"
        disabled={!canSubmit}
        className="absolute right-2 bottom-2"
        // Keep focus in the field, so pressing the button is not a click away.
        onMouseDown={(event) => event.preventDefault()}
        onClick={submit}>
        {comment || !allowEmpty ? t('agent.preview_pane.comment.submit') : t('agent.preview_pane.comment.quote')}
      </Button>
    </div>
  )
}
