import { useTopicMessages } from '@renderer/hooks/useMessageOperations'
import { getGroupedMessages } from '@renderer/services/MessagesService'
import type { Topic } from '@renderer/types'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import MessageGroup from '../MessageGroup'

interface Props {
  /** The branch topic. Must be the same id that useBranchFork dispatched sendMessage with. */
  topic: Topic
}

/**
 * BranchMessageStream — T-006D-2B side-by-side stream renderer.
 *
 * Reuses the main chat's MessageGroup renderer; the only difference vs the
 * primary <Messages> chain is what we DON'T do:
 *  - no InfiniteScroll wrapper (branches are short — one round expected)
 *  - no NarrowLayout (panel is fixed-width)
 *  - no EventEmitter registration (SEND_MESSAGE / NEW_BRANCH / CLEAR_MESSAGES
 *    etc. — those are owned by Messages.tsx; double-registering would
 *    duplicate global side effects)
 *  - no scroll-position cache
 *  - no MessageAnchorLine / SelectionBox / MultiSelectActionPopup
 *
 * The data source is identical: Redux `state.messages.messageIdsByTopic[id]`
 * via `useTopicMessages(topic.id)`. Streaming updates land here the same way
 * they land in the main view — see preflight §W1.
 *
 * Scrolling (S5'): this component is the scroll container — `overflow-y-auto`
 * + `min-h-0 flex-1` so it consumes the panel's remaining vertical space.
 * New messages trigger a single scroll-to-bottom (matching main chat's
 * post-send behaviour without the column-reverse / InfiniteScroll machinery).
 * We intentionally do NOT auto-scroll on every block update mid-stream — that
 * would fight the user if they scroll up to re-read while the assistant is
 * still streaming.
 */
export default function BranchMessageStream({ topic }: Props) {
  const { t } = useTranslation()
  const messages = useTopicMessages(topic.id)
  const scrollRef = useRef<HTMLDivElement>(null)

  const groupedMessages = useMemo(() => Object.entries(getGroupedMessages(messages)), [messages])

  // Scroll to bottom when message count changes (new user / new assistant
  // message). rAF defers until after layout so scrollHeight reflects the
  // freshly-rendered content.
  useEffect(() => {
    if (!scrollRef.current || messages.length === 0) return
    const el = scrollRef.current
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  }, [messages.length])

  if (messages.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground text-sm"
        data-testid="branch-stream-empty">
        {t('chat.message.anchor.panel.empty_stream')}
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4" data-testid="branch-stream">
      {groupedMessages.map(([key, groupMessages]) => (
        <MessageGroup key={key} messages={groupMessages} topic={topic} />
      ))}
    </div>
  )
}
