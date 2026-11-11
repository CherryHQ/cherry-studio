import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import type { CherryUIMessage } from '@shared/data/types/message'

import { MessagePreviewContent } from '../blocks/MessagePreviewContent'
import { useMessageRenderConfig } from '../MessageListProvider'
import type { MessageListItem } from '../types'
import MessageHeader from './MessageHeader'
import { MessageUserBubble } from './MessageUserBubble'
import { MessageUserLayout } from './MessageUserLayout'

export function MessagePreview({ message, item }: { message: CherryUIMessage; item: MessageListItem }) {
  const config = useMessageRenderConfig()
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
        (element.firstElementChild?.getBoundingClientRect().height ?? element.scrollHeight) > element.clientHeight
      )
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [message.parts, expanded])
  const content = (
    <div
      className="min-w-0 max-w-full"
      style={{
        fontFamily: config.messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
        fontSize: config.fontSize
      }}>
      <div
        ref={contentRef}
        className={user ? 'overflow-hidden' : 'flex flex-col justify-end overflow-hidden'}
        style={{ maxHeight: user ? (expanded ? '10lh' : '3lh') : '8lh' }}>
        <div className="shrink-0">
          <MessagePreviewContent message={message} renderInputMessageAsMarkdown={config.renderInputMessageAsMarkdown} />
        </div>
      </div>
      {truncated && (
        <span aria-hidden className="text-muted-foreground">
          …
        </span>
      )}
      {user && (expanded || truncated) && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 h-7 px-0 text-muted-foreground"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}>
          {t(expanded ? 'message.message.user_content.collapse' : 'message.message.user_content.expand')}
        </Button>
      )}
    </div>
  )
  return (
    <div className={user ? 'shrink-0' : 'min-h-0 overflow-hidden'}>
      {user && config.messageStyle === 'bubble' ? (
        <MessageUserLayout>
          <MessageUserBubble messageFont={config.messageFont} fontSize={config.fontSize}>
            {content}
          </MessageUserBubble>
        </MessageUserLayout>
      ) : (
        <MessageHeader message={item} contentSlot={content} />
      )}
    </div>
  )
}
