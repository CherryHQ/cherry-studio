import { describe, expect, it } from 'vitest'

import type { CherryUIMessage } from '@shared/data/types/message'

import { projectAgentTimeline } from '../agentTimeline'

const input = (id: string, pos?: number): CherryUIMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text: id }],
  timeline: { pos }
})
const run: CherryUIMessage = {
  id: 'run',
  role: 'assistant',
  partIds: ['prose', 'tool', 'answer', 'last'],
  partPositions: [2, 3, 5, 7],
  parts: [
    { type: 'text', text: 'Before', state: 'done' },
    { type: 'dynamic-tool', toolName: 'bash', toolCallId: 'call', input: {}, state: 'input-available' },
    { type: 'text', text: 'After first steer', state: 'done' },
    { type: 'text', text: 'After second steer', state: 'streaming' }
  ]
}

describe('Agent timeline display', () => {
  it('places new output after each placed input while keeping the original tool in its segment', () => {
    const rows = projectAgentTimeline(
      [input('prompt', 1), run, input('first', 4), input('second', 6)],
      (message) => message
    )
    expect(rows.map(({ id }) => id)).toEqual(['prompt', 'run', 'first', 'run:part:answer', 'second', 'run:part:last'])
    expect(
      rows.filter((row) => row.sourceMessageId).map((row) => [row.sourceMessageId, row.partIds, row.isRunBoundary])
    ).toEqual([
      ['run', ['prose', 'tool'], false],
      ['run', ['answer'], false],
      ['run', ['last'], true]
    ])
  })

  it('does not use an unplaced queued input as a boundary', () => {
    const rows = projectAgentTimeline([input('prompt', 1), run, input('queued')], (message) => message)
    expect(rows.map(({ id }) => id)).toEqual(['prompt', 'run', 'queued'])
    expect(rows[1].partIds).toEqual(run.partIds)
  })

  it('retains segment identity through later steers and preserves unaffected rows', () => {
    const first = input('first', 4)
    const second = input('second', 6)
    const messages = [input('prompt', 1), run, first, second]
    const rows = projectAgentTimeline(messages, (message) => message)
    const more = {
      ...run,
      partIds: [...run.partIds!, 'extra'],
      partPositions: [...run.partPositions!, 8],
      parts: [...run.parts, { type: 'text' as const, text: 'More', state: 'streaming' as const }]
    }
    const next = projectAgentTimeline(messages, (message) => (message.id === run.id ? more : message), rows)
    expect(next[1]).toBe(rows[1])
    expect(next[3]).toBe(rows[3])
    expect(next.at(-1)?.id).toBe(rows.at(-1)?.id)
    expect(next.at(-1)?.partIds).toEqual(['last', 'extra'])
  })

  it('keeps legacy parts and an already open text part at their original positions', () => {
    const text = {
      ...run,
      partIds: ['legacy', 'open'],
      partPositions: [null, 2],
      parts: [
        { type: 'text' as const, text: 'Legacy' },
        { type: 'text' as const, text: 'Still streaming after steer', state: 'streaming' as const }
      ]
    }
    const rows = projectAgentTimeline([input('prompt', 1), text, input('steer', 3)], (message) => message)
    expect(rows.map(({ id }) => id)).toEqual(['prompt', 'run', 'steer'])
    expect(rows[1].parts).toEqual(text.parts)
  })
})
