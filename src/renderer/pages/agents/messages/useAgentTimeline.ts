import { useMemo, useRef, useSyncExternalStore } from 'react'

import { messageProjectionService } from '@renderer/services/aiTransport'
import type { MessagePartRows } from '@renderer/utils/message/messagePartRows'
import { messagePartsAt } from '@renderer/utils/message/messagePartRows'
import type { ProjectionTarget } from '@shared/ai/messageProjection'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

import { type AgentTimelineRow, projectAgentTimeline } from './agentTimeline'

export function useAgentTimeline(
  messages: readonly CherryUIMessage[],
  parts: MessagePartRows,
  target?: ProjectionTarget
) {
  const previous = useRef<{ rows: AgentTimelineRow[]; parts: Record<string, CherryMessagePart[]> } | undefined>(
    undefined
  )
  const selection = useMemo(() => {
    const sourceIds = new Set(messages.map((message) => message.id))
    let snapshot: ReturnType<typeof read> | undefined
    function read() {
      const rows = projectAgentTimeline(
        messages,
        (message) => {
          const baseline = { ...message, parts: messagePartsAt(parts, message.id) ?? message.parts }
          return target ? messageProjectionService.readMessage(target, baseline) : baseline
        },
        previous.current?.rows
      )
      const before = previous.current
      if (before && rows.length === before.rows.length && rows.every((row, index) => row === before.rows[index]))
        return before
      return (previous.current = { rows, parts: Object.fromEntries(rows.map((row) => [row.id, row.parts])) })
    }
    const getSnapshot = () => (snapshot ??= read())
    return {
      getSnapshot,
      subscribe(listener: () => void) {
        if (!target) return () => {}
        const reset = () => {
          snapshot = undefined
          listener()
        }
        const off = messageProjectionService.observeLayout(
          target,
          (changes) => {
            if ([...changes.values()].some((change) => !change.before && sourceIds.has(change.row))) reset()
          },
          reset
        )
        reset()
        return off
      }
    }
  }, [messages, parts, target])
  return useSyncExternalStore(selection.subscribe, selection.getSnapshot)
}
