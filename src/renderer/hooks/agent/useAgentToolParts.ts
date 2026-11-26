import { useMemo, useSyncExternalStore } from 'react'

import { useAgentSessionStreamTopic } from '@renderer/hooks/agent/useAgentSessionStreamTopic'
import { messageProjectionService } from '@renderer/services/aiTransport'
import { PartOverrides, type MessagePartRows } from '@renderer/utils/message/messagePartRows'
import { collect, concat, foldLayout, single, type Range } from '@renderer/utils/message/projectionRange'
import type { ProjectionTarget } from '@shared/ai/messageProjection'
import type { CherryMessagePart } from '@shared/data/types/message'

export function useAgentToolParts(
  sessionId: string | undefined,
  baseline: MessagePartRows,
  accepts: (part: CherryMessagePart) => boolean
): MessagePartRows {
  const topicId = useAgentSessionStreamTopic(sessionId)
  const target = useMemo(() => (topicId ? { kind: 'topic' as const, topicId } : undefined), [topicId])
  return useProjectedToolParts(target, baseline, accepts)
}

export function useProjectedToolParts(
  target: ProjectionTarget | undefined,
  baseline: MessagePartRows,
  accepts: (part: CherryMessagePart) => boolean
): MessagePartRows {
  const selection = useMemo(() => {
    if (!target || !(baseline instanceof PartOverrides))
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
    let value: PartOverrides | undefined
    const read = (id: string, parts: CherryMessagePart[]) => {
      const row = reader.row(id)
      return row ? collect(select(row.getSnapshot()) ?? undefined) : parts.filter(accepts)
    }
    const getSnapshot = () => {
      if (value) return value
      const live = new Map<string, CherryMessagePart[]>()
      for (const [id, parts] of baseline.replacements) live.set(id, read(id, parts))
      value = new PartOverrides(baseline.base, live)
      return value
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
            const changed = new Map<string, CherryMessagePart[]>()
            for (const { row, before, after } of changes.values()) {
              const parts = baseline.replacements.get(row)
              if (parts && (accepts(after) || (before && accepts(before)))) changed.set(row, parts)
            }
            if (!changed.size) return
            const live = new Map(getSnapshot().replacements)
            for (const [id, parts] of changed) live.set(id, read(id, parts))
            value = new PartOverrides(baseline.base, live)
            listener()
          },
          reset
        )
        reset()
        return off
      }
    }
  }, [target, baseline, accepts])
  return useSyncExternalStore(selection.subscribe, selection.getSnapshot)
}
