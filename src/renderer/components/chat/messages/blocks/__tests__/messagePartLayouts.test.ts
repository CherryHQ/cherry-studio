import { describe, expect, it } from 'vitest'

import type { CherryMessagePart } from '@shared/data/types/message'

import {
  findOpenTextTailIndex,
  type MessagePartLayoutItem,
  type PartEntry,
  projectCompletedMessageParts,
  projectLiveMessageParts
} from '../messagePartLayouts'

function entries(parts: readonly Record<string, unknown>[]): PartEntry[] {
  return parts.map((part, index) => ({ part: part as CherryMessagePart, index }))
}

function indexes(items: readonly PartEntry[]): number[] {
  return items.map((entry) => entry.index)
}

function historyEntries(items: readonly MessagePartLayoutItem[]): PartEntry[] {
  return items.flatMap((item) => (item.kind === 'process' ? item.entries : []))
}

function inlineEntries(items: readonly MessagePartLayoutItem[]): PartEntry[] {
  return items.flatMap((item) => (item.kind === 'part' ? [item.entry] : []))
}

function generateImagePart(toolName: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'dynamic-tool',
    toolCallId: 'generate-image',
    toolName,
    state: 'output-available',
    ...overrides
  }
}

function entriesWithSpecialParts(): PartEntry[] {
  return entries([
    { type: 'text', text: 'First update' },
    { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
    { type: 'data-code', data: { content: 'answer()', language: 'ts' } },
    { type: 'data-compact', data: { content: 'Summary' } },
    { type: 'data-translation', data: { content: 'Translation' } },
    { type: 'data-conversation-reset', data: {} },
    { type: 'data-compaction-anchor', data: { phase: 'in-loop' } },
    { type: 'reasoning', text: 'Checking', state: 'done' },
    { type: 'dynamic-tool', toolCallId: 'edit', toolName: 'Edit', state: 'output-available' },
    { type: 'dynamic-tool', toolCallId: 'ask', toolName: 'AskUserQuestion', state: 'output-available' },
    generateImagePart('generate_image', { output: [{ id: 'file-1', name: 'sunset.png' }] }),
    {
      type: 'dynamic-tool',
      toolCallId: 'channel-auth',
      toolName: 'mcp__cherry-tools__config',
      state: 'output-available',
      input: { action: 'add_channel', type: 'wechat', auth_mode: 'qr' },
      output: {
        content: [
          { type: 'text', text: 'Scan this QR code' },
          { type: 'image', data: 'BASE64', mimeType: 'image/png' }
        ],
        metadata: { type: 'mcp', serverId: 'cherry-tools', serverName: 'cherry-tools' }
      }
    },
    { type: 'file', mediaType: 'image/png', url: 'file:///result.png' },
    { type: 'data-video', data: { filePath: '/tmp/result.mp4' } },
    { type: 'data-error', data: { message: 'Error' } },
    {
      type: 'dynamic-tool',
      toolCallId: 'report',
      toolName: 'mcp__cherry__report_artifacts',
      state: 'output-available'
    },
    { type: 'text', text: 'Final answer' }
  ])
}

function nonTextIndexes(items: readonly PartEntry[]): number[] {
  return items.filter((entry) => entry.part.type !== 'text').map((entry) => entry.index)
}

describe('projectLiveMessageParts', () => {
  it('keeps special parts on their existing side of live process boundaries when enabled', () => {
    const parts = entriesWithSpecialParts()
    const before = projectLiveMessageParts(parts)
    const after = projectLiveMessageParts(parts, { keepIntermediateAssistantText: true })
    const processIndexes = (items: typeof after) =>
      nonTextIndexes(items.flatMap((item) => (item.kind === 'process' ? item.entries : [])))
    const directIndexes = (items: typeof after) =>
      nonTextIndexes(items.flatMap((item) => (item.kind === 'part' ? [item.entry] : [])))

    expect(processIndexes(after)).toEqual(processIndexes(before))
    expect(directIndexes(after)).toEqual(directIndexes(before))
    expect(directIndexes(after)).toContain(9)
    expect(directIndexes(after)).toContain(10)
    expect(directIndexes(after)).toContain(11)
    expect(directIndexes(after)).toContain(15)
    expect(
      after.filter((item) => item.kind === 'part' && item.entry.part.type === 'text').map((item) => item.key)
    ).toEqual([0, 16])
  })

  it('keeps prose between successive tools in the response lane when enabled', () => {
    const layout = projectLiveMessageParts(
      entries([
        { type: 'text', text: 'First update' },
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'text', text: 'Second update' },
        { type: 'dynamic-tool', toolCallId: 'edit', toolName: 'Edit', state: 'output-available' },
        { type: 'text', text: 'Final answer' }
      ]),
      { keepIntermediateAssistantText: true }
    )

    expect(layout.map((item) => [item.kind, item.key])).toEqual([
      ['part', 0],
      ['process', 1],
      ['part', 2],
      ['process', 3],
      ['part', 4]
    ])
    expect(indexes(historyEntries(layout))).toEqual([1, 3])
  })

  it('keeps approval-backed AskUserQuestion direct', () => {
    const layout = projectLiveMessageParts(
      entries([
        {
          type: 'dynamic-tool',
          toolCallId: 'ask',
          toolName: 'AskUserQuestion',
          state: 'approval-requested'
        }
      ])
    )

    expect(layout.map((item) => [item.kind, item.key])).toEqual([['part', 0]])
  })

  it('keeps approval-gated tools in one stable process as their state advances', () => {
    const requestedLayout = projectLiveMessageParts(
      entries([
        { type: 'reasoning', text: 'Preparing changes', state: 'done' },
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        {
          type: 'dynamic-tool',
          toolCallId: 'approved',
          toolName: 'Write',
          state: 'approval-requested',
          approval: { id: 'approval-1' }
        },
        { type: 'dynamic-tool', toolCallId: 'edit', toolName: 'Edit', state: 'input-available' }
      ])
    )
    const respondedLayout = projectLiveMessageParts(
      entries([
        { type: 'reasoning', text: 'Preparing changes', state: 'done' },
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        {
          type: 'dynamic-tool',
          toolCallId: 'approved',
          toolName: 'Write',
          state: 'approval-responded',
          approval: { id: 'approval-1', approved: true }
        },
        { type: 'dynamic-tool', toolCallId: 'edit', toolName: 'Edit', state: 'input-available' }
      ])
    )

    expect(requestedLayout.map((item) => [item.kind, item.key])).toEqual([['process', 0]])
    expect(requestedLayout[0].kind === 'process' ? indexes(requestedLayout[0].entries) : []).toEqual([0, 1, 2, 3])
    expect(respondedLayout.map((item) => [item.kind, item.key])).toEqual([['process', 0]])
    expect(respondedLayout[0].kind === 'process' ? indexes(respondedLayout[0].entries) : []).toEqual([0, 1, 2, 3])
  })

  it('does not create visible runs from hidden markers or empty settled reasoning', () => {
    const hiddenOnly = projectLiveMessageParts(
      entries([
        { type: 'step-start' },
        { type: 'source-url' },
        { type: 'source-document' },
        { type: 'data-agent-task-event', data: {} },
        { type: 'data-knowledge-scope', data: { baseIds: ['kb-1'] } },
        { type: 'data-clear', data: {} }
      ])
    )
    const emptyReasoning = projectLiveMessageParts(entries([{ type: 'reasoning', text: '', state: 'done' }]))

    expect(hiddenOnly).toEqual([])
    expect(emptyReasoning).toEqual([])
  })

  it('keeps an addressed open text row mounted before the first suffix arrives', () => {
    const entry = { part: { type: 'text', text: '', state: 'streaming' }, index: 0, partId: 'reply' } as const
    expect(projectLiveMessageParts([entry])).toEqual([{ kind: 'part', key: 'reply', entry }])
    expect(projectLiveMessageParts([{ ...entry, part: { ...entry.part, state: 'done' } }])).toEqual([])
  })

  it('does not let empty settled text or reasoning split a continuous tool run', () => {
    const layout = projectLiveMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'text', text: '' },
        { type: 'reasoning', text: '   ', state: 'done' },
        { type: 'dynamic-tool', toolCallId: 'edit', toolName: 'Edit', state: 'input-available' }
      ])
    )

    expect(layout).toHaveLength(1)
    expect(layout[0].kind === 'process' ? indexes(layout[0].entries) : []).toEqual([0, 3])
  })

  it('treats provider ellipsis fillers as transparent within a live process run', () => {
    const layout = projectLiveMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'text', text: '...' },
        { type: 'source-url', url: 'https://example.com' },
        { type: 'text', text: '…' },
        { type: 'dynamic-tool', toolCallId: 'edit', toolName: 'Edit', state: 'input-available' }
      ])
    )

    expect(layout).toHaveLength(1)
    expect(layout[0].kind === 'process' ? indexes(layout[0].entries) : []).toEqual([0, 4])
  })

  it('holds only a process-adjacent trailing ellipsis while the next live part is unknown', () => {
    const processTail = projectLiveMessageParts(
      entries([
        { type: 'reasoning', text: 'Preparing tool call', state: 'done' },
        { type: 'text', text: '...' }
      ])
    )
    const standaloneEllipsis = projectLiveMessageParts(entries([{ type: 'text', text: '...' }]))

    expect(processTail).toHaveLength(1)
    expect(processTail[0].kind === 'process' ? indexes(processTail[0].entries) : []).toEqual([0])
    expect(standaloneEllipsis.map((item) => [item.kind, item.key])).toEqual([['part', 0]])
  })

  it('preserves ordinary prose containing an ellipsis', () => {
    const layout = projectLiveMessageParts(
      entries([
        { type: 'text', text: 'Wait...' },
        { type: 'text', text: '.....' },
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'input-available' }
      ])
    )

    expect(layout.map((item) => [item.kind, item.key])).toEqual([['process', 0]])
    expect(layout[0].kind === 'process' ? indexes(layout[0].entries) : []).toEqual([0, 1, 2])
  })

  it('keeps the existing split with the switch off across two tool calls', () => {
    const layout = projectLiveMessageParts(
      entries([
        { type: 'text', text: 'First update' },
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'text', text: 'Second update' },
        { type: 'dynamic-tool', toolCallId: 'edit', toolName: 'Edit', state: 'output-available' },
        { type: 'text', text: 'Final answer' }
      ]),
      { keepIntermediateAssistantText: false }
    )

    expect(layout.map((item) => [item.kind, item.key])).toEqual([
      ['process', 0],
      ['part', 4]
    ])
    expect(layout[0].kind === 'process' ? indexes(layout[0].entries) : []).toEqual([0, 1, 2, 3])
  })
})

describe('findOpenTextTailIndex', () => {
  it('selects only the final text/code tail while ignoring trailing hidden markers', () => {
    expect(
      findOpenTextTailIndex(
        entries([
          { type: 'text', text: 'Earlier' },
          { type: 'data-code', data: { content: 'const value = 1', language: 'ts' } },
          { type: 'step-start' },
          { type: 'source-url' }
        ])
      )
    ).toBe(1)
  })

  it('returns null when a visible process/value part seals the text tail', () => {
    expect(
      findOpenTextTailIndex(
        entries([
          { type: 'text', text: 'Done' },
          { type: 'data-citation', data: {} },
          { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'input-available' }
        ])
      )
    ).toBeNull()
  })

  it('does not reopen a completed text tail when the turn becomes active again', () => {
    expect(findOpenTextTailIndex(entries([{ type: 'text', text: 'Already complete', state: 'done' }]))).toBeNull()
    expect(findOpenTextTailIndex(entries([{ type: 'text', text: 'Current delta', state: 'streaming' }]))).toBe(0)
  })
})

describe('projectCompletedMessageParts', () => {
  it('keeps special parts in their existing completed lanes when enabled', () => {
    const parts = entriesWithSpecialParts()
    const before = projectCompletedMessageParts(parts)
    const after = projectCompletedMessageParts(parts, { keepIntermediateAssistantText: true })

    expect(nonTextIndexes(historyEntries(after.items))).toEqual(nonTextIndexes(historyEntries(before.items)))
    expect(nonTextIndexes(inlineEntries(after.items))).toEqual(nonTextIndexes(inlineEntries(before.items)))
    expect(indexes(after.reportEntries)).toEqual(indexes(before.reportEntries))
    expect(indexes(historyEntries(after.items))).toContain(6)
    expect(indexes(inlineEntries(after.items))).toContain(10)
    expect(indexes(inlineEntries(after.items))).toContain(11)
    expect(indexes(after.reportEntries)).toEqual([15])
    expect(
      inlineEntries(after.items)
        .filter((entry) => entry.part.type === 'text')
        .map((entry) => entry.index)
    ).toEqual([0, 16])
  })

  it('keeps prose between successive tools in the response lane when enabled', () => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'text', text: 'First update' },
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'text', text: 'Second update' },
        { type: 'dynamic-tool', toolCallId: 'edit', toolName: 'Edit', state: 'output-available' },
        { type: 'text', text: 'Final answer' }
      ]),
      { keepIntermediateAssistantText: true }
    )

    expect(indexes(historyEntries(layout.items))).toEqual([1, 3])
    expect(indexes(inlineEntries(layout.items))).toEqual([0, 2, 4])
  })

  it('keeps the existing split with the switch off across two tool calls', () => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'text', text: 'First update' },
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'text', text: 'Second update' },
        { type: 'dynamic-tool', toolCallId: 'edit', toolName: 'Edit', state: 'output-available' },
        { type: 'text', text: 'Final answer' }
      ]),
      { keepIntermediateAssistantText: false }
    )

    expect(indexes(historyEntries(layout.items))).toEqual([0, 1, 2, 3])
    expect(indexes(inlineEntries(layout.items))).toEqual([4])
  })

  it.each([
    [
      [
        { type: 'text', text: 'Answer' },
        { type: 'reasoning', text: 'Trailing thought' }
      ]
    ],
    [[{ type: 'file', url: 'https://example.com/result.png', mediaType: 'image/png' }]]
  ])('keeps a fork link direct without changing the original result grouping: %j', (parts) => {
    const original = entries(parts)
    const marker = {
      part: { type: 'data-agent-session-fork', data: { sourceSessionId: 'parent' } },
      index: parts.length
    } as PartEntry
    const before = projectCompletedMessageParts(original)
    expect(projectCompletedMessageParts([...original, marker])).toEqual({
      ...before,
      items: [...before.items, { kind: 'part', key: marker.index, entry: marker }]
    })
  })

  it('keeps prose and attachments in place when a reply ends in further process activity', () => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'text', text: 'Initial narration' },
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'text', text: 'Final answer' },
        { type: 'file', mediaType: 'image/png', url: 'file:///result.png' },
        { type: 'data-video', data: { filePath: '/tmp/result.mp4' } },
        { type: 'reasoning', text: 'Bookkeeping', state: 'done' },
        { type: 'dynamic-tool', toolCallId: 'cleanup', toolName: 'Cleanup', state: 'output-available' }
      ])
    )

    expect(indexes(inlineEntries(layout.items))).toEqual([])
    expect(indexes(historyEntries(layout.items))).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('keeps interleaved attachments with prose in a tool-ended process', () => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'text', text: 'First answer paragraph' },
        { type: 'file', mediaType: 'image/png', url: 'file:///result.png' },
        { type: 'text', text: 'Second answer paragraph' },
        { type: 'dynamic-tool', toolCallId: 'cleanup', toolName: 'Cleanup', state: 'output-available' }
      ])
    )

    expect(indexes(historyEntries(layout.items))).toEqual([0, 1, 2, 3, 4])
    expect(indexes(inlineEntries(layout.items))).toEqual([])
  })

  it('does not let hidden transport markers split associated final-answer values', () => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'text', text: 'Final answer' },
        { type: 'data-citation', data: {} },
        { type: 'file', mediaType: 'image/png', url: 'file:///result.png' }
      ])
    )

    expect(indexes(historyEntries(layout.items))).toEqual([0])
    expect(indexes(inlineEntries(layout.items))).toEqual([1, 3])
  })

  it('leaves pure text entirely in the result', () => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'text', text: 'First paragraph' },
        { type: 'data-code', data: { content: 'answer()', language: 'ts' } },
        { type: 'data-translation', data: { content: 'Translated answer' } }
      ])
    )

    expect(indexes(inlineEntries(layout.items))).toEqual([0, 1, 2])
    expect(historyEntries(layout.items)).toEqual([])
  })

  it('does not let an empty settled tail replace the last substantive answer', () => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'text', text: 'Final answer' },
        { type: 'text', text: '' }
      ])
    )

    expect(indexes(inlineEntries(layout.items))).toEqual([1])
    expect(indexes(historyEntries(layout.items))).toEqual([0])
  })

  it('lets an associated result value cross an empty terminal content part', () => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'text', text: 'Final answer' },
        { type: 'text', text: '' },
        { type: 'file', mediaType: 'application/pdf', url: 'file:///result.pdf' }
      ])
    )

    expect(indexes(historyEntries(layout.items))).toEqual([0])
    expect(indexes(inlineEntries(layout.items))).toEqual([1, 3])
  })

  it('removes only tool-bound ellipsis fillers from completed projection', () => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'text', text: '...' },
        { type: 'dynamic-tool', toolCallId: 'edit', toolName: 'Edit', state: 'output-available' },
        { type: 'text', text: 'Final answer...' }
      ])
    )
    const ellipsisAnswer = projectCompletedMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'text', text: '...' }
      ])
    )

    expect(indexes(historyEntries(layout.items))).toEqual([0, 2])
    expect(indexes(inlineEntries(layout.items))).toEqual([3])
    expect(indexes(historyEntries(ellipsisAnswer.items))).toEqual([0])
    expect(indexes(inlineEntries(ellipsisAnswer.items))).toEqual([1])
  })

  it('keeps a value-only response and a final value tail outside process history', () => {
    const pureValues = projectCompletedMessageParts(
      entries([
        { type: 'data-error', data: { message: 'Failed' } },
        { type: 'file', mediaType: 'image/png', url: 'file:///result.png' },
        { type: 'data-video', data: { filePath: '/tmp/result.mp4' } }
      ])
    )
    const trailingValues = projectCompletedMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'source-url', url: 'https://example.com' },
        { type: 'file', mediaType: 'application/pdf', url: 'file:///result.pdf' }
      ])
    )

    expect(indexes(inlineEntries(pureValues.items))).toEqual([0, 1, 2])
    expect(historyEntries(pureValues.items)).toEqual([])
    expect(indexes(historyEntries(trailingValues.items))).toEqual([0])
    expect(indexes(inlineEntries(trailingValues.items))).toEqual([2])
  })

  it('preserves an interleaved AskUser boundary between completed tool groups', () => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        {
          type: 'dynamic-tool',
          toolCallId: 'ask',
          toolName: 'AskUserQuestion',
          state: 'output-available'
        },
        { type: 'dynamic-tool', toolCallId: 'edit', toolName: 'Edit', state: 'output-available' },
        { type: 'text', text: 'Final answer' }
      ])
    )

    expect(layout.items.map((item) => [item.kind, item.key])).toEqual([
      ['process', 0],
      ['part', 1],
      ['process', 2],
      ['part', 3]
    ])
  })

  it('keeps the introduction and search narration on either side of AskUserQuestion after Stop', () => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'text', text: 'PR review result' },
        {
          type: 'dynamic-tool',
          toolCallId: 'ask',
          toolName: 'AskUserQuestion',
          state: 'output-available'
        },
        { type: 'text', text: 'I will search now' },
        { type: 'dynamic-tool', toolCallId: 'search', toolName: 'Search', state: 'output-error' }
      ])
    )

    expect(layout.items.map((item) => (item.kind === 'process' ? indexes(item.entries) : item.entry.index))).toEqual([
      [0, 1],
      2,
      [3, 4]
    ])
  })

  it('extracts report_artifacts without letting it split the final answer result', () => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'text', text: 'Final answer' },
        {
          type: 'dynamic-tool',
          toolCallId: 'report',
          toolName: 'mcp__cherry__report_artifacts',
          state: 'output-available'
        },
        { type: 'file', mediaType: 'text/markdown', url: 'file:///report.md' }
      ])
    )

    expect(indexes(historyEntries(layout.items))).toEqual([0])
    expect(indexes(inlineEntries(layout.items))).toEqual([1, 3])
    expect(indexes(layout.reportEntries)).toEqual([2])
  })
})

// Imported tools must remain between the reasoning steps that surround them.
it('preserves imported reasoning and tool chronology outside the answer lane', () => {
  const parts = entries([
    { type: 'reasoning', text: 'First thought', state: 'done' },
    {
      type: 'dynamic-tool',
      toolName: 'deepseek_search',
      toolCallId: 'search',
      state: 'output-available',
      input: { queries: ['question'] },
      output: { results: [], status: 'FINISHED' }
    },
    { type: 'reasoning', text: 'Second thought', state: 'done' },
    {
      type: 'dynamic-tool',
      toolName: 'deepseek_open',
      toolCallId: 'open',
      state: 'output-available',
      input: { url: 'https://example.com' },
      output: { status: 'FINISHED' }
    },
    { type: 'text', text: 'Final answer' },
    { type: 'data-imported-status', data: { status: 'INCOMPLETE' } }
  ])
  const layout = projectCompletedMessageParts(parts, { keepIntermediateAssistantText: true })
  expect(indexes(historyEntries(layout.items))).toEqual([0, 1, 2, 3])
  expect(indexes(inlineEntries(layout.items))).toEqual([4, 5])
})
