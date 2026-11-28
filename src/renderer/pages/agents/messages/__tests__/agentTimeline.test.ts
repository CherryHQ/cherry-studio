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
  it('keeps a paused imported reply as one historical record when native part IDs are available', () => {
    const history: CherryUIMessage = {
      ...run,
      metadata: { status: 'paused', provenance: { source: 'claude-code', sourceOrder: 1 } }
    }
    const rows = projectAgentTimeline([history, input('follow-up', 4)], (message) => message)
    expect(rows.map((row) => row.id)).toEqual(['run', 'follow-up'])
    expect(rows[0].partIds).toEqual(run.partIds)
  })

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

it('assigns one identity header and one action boundary across all content segments of a Run', () => {
  const rows = projectAgentTimeline([input('prompt', 1), run, input('steer', 4)], (message) => message)
  expect(rows.filter((row) => row.showHeader).map((row) => row.id)).toEqual(['run'])
  expect(rows.filter((row) => row.isRunBoundary).map((row) => row.id)).toEqual(['run:part:answer'])
})

it('projects a compaction-only reply as a marker without an assistant identity or action boundary', () => {
  const compact: CherryUIMessage = {
    id: 'compact',
    role: 'assistant',
    partIds: ['fold'],
    partPositions: [2],
    parts: [
      { type: 'data-compaction-anchor', id: 'native-fold', data: { phase: 'agent-session', status: 'compacting' } }
    ]
  }
  const before = projectAgentTimeline([input('command', 1), compact, input('steer', 3)], (message) => message)
  expect(before.map((row) => [row.id, row.kind])).toEqual([
    ['command', undefined],
    ['compact:marker:fold', 'marker'],
    ['steer', undefined]
  ])
  expect(before.filter((row) => row.showHeader || row.isRunBoundary)).toEqual([])
  const done: CherryUIMessage = {
    ...compact,
    parts: [{ type: 'data-compaction-anchor', id: 'native-fold', data: { phase: 'agent-session', status: 'done' } }]
  }
  expect(projectAgentTimeline([input('command', 1), done, input('steer', 3)], (message) => message)[1].id).toBe(
    before[1].id
  )
})

it('preserves an existing content segment when a marker and a continuation arrive, and adds one paused boundary', () => {
  const original: CherryUIMessage = {
    ...run,
    partIds: run.partIds!.slice(0, 2),
    parts: run.parts.slice(0, 2),
    partPositions: [2, 3]
  }
  const before = projectAgentTimeline([original], (message) => message)
  const after: CherryUIMessage = {
    ...original,
    metadata: { status: 'paused' },
    partIds: [...original.partIds!, 'fold', 'next'],
    partPositions: [2, 3, 4, 5],
    parts: [
      ...original.parts,
      { type: 'data-compaction-anchor', data: { status: 'done', phase: 'agent-session' } },
      { type: 'text', text: 'Continuation' }
    ]
  }
  const rows = projectAgentTimeline([after], (message) => message, before)
  expect(rows.map((row) => row.id)).toEqual(['run', 'run:marker:fold', 'run:part:next', 'run:interrupted'])
  expect(rows[0].partIds).toEqual(before[0].partIds)
  expect(rows.filter((row) => row.showHeader)).toHaveLength(1)
  expect(rows.at(-1)?.kind).toBe('interrupted')
})

it.each([true, false])('places interruption after the latest admitted input of its Run, content=%s', (hasContent) => {
  const paused: CherryUIMessage = {
    id: 'run',
    role: 'assistant',
    metadata: { status: 'paused' },
    partIds: hasContent ? ['text'] : [],
    partPositions: hasContent ? [2] : [],
    parts: hasContent ? [{ type: 'text', text: 'Before steer', state: 'done' }] : []
  }
  const steer = { ...input('steer', 3), timeline: { pos: 3, replyId: 'run' } }
  const queued = { ...input('queued'), timeline: { replyId: 'run' } }
  const other = { ...input('other', 4), timeline: { pos: 4, replyId: 'other-run' } }
  const rows = projectAgentTimeline([input('prompt', 1), paused, steer, queued, other], (message) => message)
  expect(rows.map((row) => row.id)).toEqual([
    'prompt',
    ...(hasContent ? ['run'] : []),
    'steer',
    'run:interrupted',
    'queued',
    'other'
  ])
})
