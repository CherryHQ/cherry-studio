/**
 * Steering observer — drains `pendingMessages` mid-flight via AI SDK's
 * `prepareStep` hook so injected user messages fold into the current
 * assistant turn without restarting `agent.stream()`.
 *
 * Why prepareStep and not an outer loop: AI SDK's inner step loop already
 * iterates calls + tool execution; prepareStep fires between steps with
 * full access to the messages array. Mutating `messages` there is the
 * native primitive for "inject content into the next round of input".
 *
 * Claude Code carve-out: the Claude Code provider consumes `pendingMessages`
 * as `AsyncIterable` directly (see AiService:295–301 wiring
 * `injectedMessageSource`). If the steering observer also drained for that
 * provider, both consumers would race. The observer no-ops there.
 */

import type { UIMessage } from 'ai'
import { convertToModelMessages } from 'ai'

import type { Agent } from '../Agent'
import type { PendingMessageQueue } from '../loop/PendingMessageQueue'

export function attachSteeringObserver(agent: Agent, queue: PendingMessageQueue): void {
  if (agent.params.providerId === 'claude-code') return

  agent.on('prepareStep', async ({ messages }) => {
    const drained = queue.drain()
    if (drained.length === 0) return undefined

    const ui: UIMessage[] = drained.map((msg) => ({
      id: msg.id,
      role: 'user' as const,
      parts: msg.data?.parts ?? []
    }))
    const additional = await convertToModelMessages(ui)
    return { messages: [...messages, ...additional] }
  })
}
