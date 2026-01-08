/**
 * @fileoverview StreamingMessageItem - Renders a single streaming message
 *
 * This component subscribes to its own streaming session cache and re-renders
 * only when that specific session updates. This is more efficient than having
 * a parent component subscribe to all sessions.
 *
 * ## Architecture
 *
 * Each streaming message renders independently:
 * ```
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Messages.tsx                                                             │
 * │   ├─ useStreamingSessionIds(topicId) → ['msg1', 'msg2']                  │
 * │   ├─ StreamingMessageItem key='msg1'                                     │
 * │   │    └─ useCache('message.streaming.session.msg1') ← subscribes here   │
 * │   └─ StreamingMessageItem key='msg2'                                     │
 * │        └─ useCache('message.streaming.session.msg2') ← subscribes here   │
 * └──────────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Why Not Group in Parent?
 *
 * TRADEOFF: Independent components vs parent-level grouping
 *
 * Parent-level grouping (rejected):
 * - Requires calling getSession() for each ID in render
 * - getSession() returns point-in-time snapshot, not reactive
 * - Parent doesn't re-render on session updates (stale data)
 *
 * Independent components (chosen):
 * - Each component subscribes via useCache
 * - Only affected component re-renders on update
 * - Multi-model grouping handled by component styling, not data structure
 *
 * ## Multi-Model Responses
 *
 * For multi-model responses (siblingsGroupId > 0):
 * - Multiple sessions share same parentId + siblingsGroupId
 * - Each renders independently in this component
 * - UI styling (horizontal layout, comparison view) handled by CSS
 * - TODO: [v2] Consider caching group metadata for shared styling
 */

import { useCache } from '@data/hooks/useCache'
import { MessageEditingProvider } from '@renderer/context/MessageEditingContext'
import type { Topic } from '@renderer/types'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import React, { memo } from 'react'

import MessageItem from './Message'

// ============================================================================
// Types
// ============================================================================

/**
 * Streaming session data structure (matches StreamingService.StreamingSession)
 *
 * NOTE: [v2 Migration] Using 'any' type because StreamingSession is defined
 * locally in StreamingService.ts and uses renderer Message/MessageBlock types.
 * Type safety is maintained by the shape we expect from the cache.
 */
interface StreamingSessionData {
  topicId: string
  messageId: string
  message: Message
  blocks: Record<string, MessageBlock>
  parentId: string
  siblingsGroupId: number
  startedAt: number
}

interface Props {
  /** Message ID that identifies the streaming session */
  messageId: string
  /** Current topic */
  topic: Topic
  /** Index in the message list (for display purposes) */
  index?: number
}

// ============================================================================
// Component
// ============================================================================

/**
 * Renders a single streaming message by subscribing to its cache key.
 *
 * This component:
 * 1. Subscribes to `message.streaming.session.${messageId}` cache key
 * 2. Re-renders when the session data updates (new blocks, content changes)
 * 3. Extracts message and blocks from session
 * 4. Renders using the same MessageItem component as API messages
 *
 * @example
 * ```tsx
 * // In parent component
 * const sessionIds = useStreamingSessionIds(topic.id)
 *
 * return (
 *   <>
 *     {sessionIds.map(id => (
 *       <StreamingMessageItem
 *         key={id}
 *         messageId={id}
 *         topic={topic}
 *       />
 *     ))}
 *   </>
 * )
 * ```
 */
const StreamingMessageItem: React.FC<Props> = ({ messageId, topic, index }) => {
  // Subscribe to this message's streaming session
  // Uses template key: 'message.streaming.session.${messageId}'
  const cacheKey = `message.streaming.session.${messageId}` as const
  const [session] = useCache(cacheKey, null)

  // Session not ready or cleared
  if (!session) {
    return null
  }

  // Type assertion: session matches StreamingSessionData shape
  const sessionData = session as StreamingSessionData

  // Extract message and blocks from session
  const { message, blocks } = sessionData

  // Convert blocks record to array
  // NOTE: [v2 Migration] StreamingService stores blocks as Record<id, block>
  // MessageItem expects either string[] (Redux) or MessageBlock[] (direct)
  // We pass the array directly (new path) to bypass Redux
  const blockArray = Object.values(blocks)

  return (
    <MessageEditingProvider>
      <MessageItem
        message={message}
        blocks={blockArray}
        topic={topic}
        index={index}
        isStreaming={true}
        // Multi-model responses have siblingsGroupId > 0
        // isGrouped styling is handled by MessageItem based on this
        isGrouped={sessionData.siblingsGroupId > 0}
      />
    </MessageEditingProvider>
  )
}

// Memoize to prevent unnecessary re-renders from parent
// The component will re-render when its cache subscription updates
export default memo(StreamingMessageItem)
