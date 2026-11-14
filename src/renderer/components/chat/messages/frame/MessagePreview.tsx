import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import type { CherryUIMessage } from '@shared/data/types/message'

import { MessagePreviewContent } from '../blocks/MessagePreviewContent'
import type { MessageRenderConfig } from '../types'
import { MessageUserBubble } from './MessageUserBubble'

export function MessagePreview({
  message,
  config,
  author
}: {
  message: CherryUIMessage
  config: Pick<MessageRenderConfig, 'messageStyle' | 'messageFont' | 'fontSize' | 'renderInputMessageAsMarkdown'>
  author: { name?: string }
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const user = message.role === 'user'
  useLayoutEffect(() => {
    const element = contentRef.current
    if (!element) return
    const measure = () =>
      setTruncated(
        (element.firstElementChild?.getBoundingClientRect().height ?? element.scrollHeight) > element.clientHeight + 1
      )
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [message.parts, expanded])
  const content = (
    <div
      className={user ? 'min-w-0 max-w-full' : 'flex min-h-0 min-w-0 max-w-full flex-col'}
      style={{
        fontFamily: config.messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
        fontSize: config.fontSize
      }}>
      {!user && truncated && (
        <span aria-hidden className="text-muted-foreground">
          …
        </span>
      )}
      <div
        ref={contentRef}
        className={user ? 'overflow-hidden' : 'flex min-h-0 flex-col justify-end overflow-hidden'}
        style={{ maxHeight: user ? (expanded ? '10lh' : '3lh') : '8lh' }}>
        <div className="shrink-0">
          <MessagePreviewContent message={message} renderInputMessageAsMarkdown={config.renderInputMessageAsMarkdown} />
        </div>
      </div>
      {user && truncated && (
        <span aria-hidden className="text-muted-foreground">
          …
        </span>
      )}
      {user && (expanded || truncated) && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}>
          {t(expanded ? 'message.message.user_content.collapse' : 'message.message.user_content.expand')}
        </Button>
      )}
    </div>
  )
  return (
    <div className={user ? 'flex shrink-0 flex-col items-end gap-2' : 'flex min-h-0 flex-col gap-2 overflow-hidden'}>
      {author.name && (
        <div className="flex min-w-0 max-w-full items-center gap-2">
          <span className="truncate font-semibold text-sm leading-5">{author.name}</span>
        </div>
      )}
      {user && config.messageStyle === 'bubble' ? (
        <MessageUserBubble messageFont={config.messageFont} fontSize={config.fontSize}>
          {content}
        </MessageUserBubble>
      ) : (
        content
      )}
    </div>
  )
}
