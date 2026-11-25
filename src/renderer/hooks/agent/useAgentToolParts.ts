import { useMemo, useSyncExternalStore } from 'react'

import { messageProjectionService } from '@renderer/services/aiTransport'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { collect, concat, foldLayout, single, type Range } from '@renderer/utils/message/projectionRange'
import type { CherryMessagePart } from '@shared/data/types/message'

type PartRows = Record<string, CherryMessagePart[]>

export function useAgentToolParts(
  sessionId: string | undefined,
  baseline: PartRows,
  accepts: (part: CherryMessagePart) => boolean
): PartRows {
  const selection = useMemo(() => {
    const target = { kind: 'topic' as const, topicId: buildAgentSessionTopicId(sessionId ?? '') }
    if (!sessionId || !messageProjectionService.getSnapshot(target).view)
      return { getSnapshot: () => baseline, subscribe: () => () => {} }
    const reader = messageProjectionService.partsFor(target)
    const select = foldLayout<Range<CherryMessagePart> | null>(
      ({ partId }) => {
        const part = reader.read(partId)
        return part && accepts(part) ? single(partId, part) : null
      },
      (left, right) => concat(left ?? undefined, right ?? undefined) ?? null,
      null
    )
    let value: PartRows | undefined
    const read = (id: string) => {
      const row = reader.row(id)
      return row ? collect(select(row.getSnapshot()) ?? undefined) : baseline[id].filter(accepts)
    }
    const getSnapshot = () => {
      return (value ??= Object.fromEntries(Object.keys(baseline).map((id) => [id, read(id)])))
    }
    return {
      getSnapshot,
      subscribe(listener: () => void) {
        const reset = () => {
          value = undefined
          listener()
        }
        const off = messageProjectionService.observeLayout(
          target,
          (changes) => {
            const rows = new Set<string>()
            for (const { row, before, after } of changes.values()) {
              if (row in baseline && (accepts(after) || (before && accepts(before)))) rows.add(row)
            }
            if (!rows.size) return
            const next = { ...getSnapshot() }
            for (const id of rows) next[id] = read(id)
            value = next
            listener()
          },
          reset
        )
        reset()
        return off
      }
    }
  }, [sessionId, baseline, accepts])
  return useSyncExternalStore(selection.subscribe, selection.getSnapshot)
}
