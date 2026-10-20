import { describe, expect, it } from 'vitest'

import { MessageRuntimeTimingCollector } from '../MessageRuntimeTimingCollector'

describe('MessageRuntimeTimingCollector', () => {
  it('keeps tool execution separate from approval wait', () => {
    const collector = new MessageRuntimeTimingCollector(undefined, 1_000)

    collector.startApproval('approval-1', 'tool-1', 'Bash', 1_100)
    collector.finishApproval({ approvalId: 'approval-1' }, 2_100)
    collector.finishTool('tool-1', 400, 'Bash', 2_500)
    collector.complete(2_600)

    expect(collector.snapshot()).toEqual({
      startedAt: 1_000,
      completedAt: 2_600,
      spans: [
        {
          id: 'approval:approval-1',
          kind: 'approval-wait',
          approvalId: 'approval-1',
          toolCallId: 'tool-1',
          toolName: 'Bash',
          startedAt: 1_100,
          completedAt: 2_100
        },
        {
          id: 'tool:tool-1',
          kind: 'tool-execution',
          toolCallId: 'tool-1',
          toolName: 'Bash',
          startedAt: 2_100,
          completedAt: 2_500
        }
      ]
    })
  })

  it('merges a continuation without discarding earlier spans', () => {
    const collector = new MessageRuntimeTimingCollector(
      {
        startedAt: 1_000,
        spans: [
          {
            id: 'approval:approval-1',
            kind: 'approval-wait',
            approvalId: 'approval-1',
            toolCallId: 'tool-1',
            startedAt: 1_500
          }
        ]
      },
      9_000
    )

    collector.finishApproval({ approvalId: 'approval-1' }, 4_000)
    collector.closeOpenSpans(5_000)
    collector.complete(5_000)

    expect(collector.snapshot()).toMatchObject({
      startedAt: 1_000,
      completedAt: 5_000,
      spans: [{ id: 'approval:approval-1', completedAt: 4_000 }]
    })
  })

  it('closes open spans on abort without inventing provider records', () => {
    const collector = new MessageRuntimeTimingCollector(undefined, 1_000)
    collector.startTool('tool-1', 'Read', 1_100)
    collector.startApproval('approval-1', 'tool-2', 'Bash', 1_200)

    collector.closeOpenSpans(2_000)
    collector.complete(2_000)

    expect(collector.snapshot().spans).toEqual([
      expect.objectContaining({ id: 'tool:tool-1', completedAt: 2_000 }),
      expect.objectContaining({ id: 'approval:approval-1', completedAt: 2_000 })
    ])
  })
})
