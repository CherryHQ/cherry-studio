import { afterEach, describe, expect, it, vi } from 'vitest'

import { taskTimingQuerySchema } from '@shared/ai/taskTiming'
import type { SpanEntity } from '@shared/data/types/trace'

import { projectTaskTiming, TaskTimingRecorder, timingOnlySpan } from '../taskTiming'

const query = taskTimingQuerySchema.parse({})

afterEach(() => vi.restoreAllMocks())

describe('original task timing', () => {
  it('measures parallel work from the task clock, including queue time, without summing nodes', () => {
    const spans = new Map<string, SpanEntity>()
    const recorder = new TaskTimingRecorder((span) => spans.set(span.id, structuredClone(span)))
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    recorder.begin('agent-session:a', 'trace', 'message')
    now = 10
    recorder.wait('message', 'queue', false)
    recorder.beginNode('message', 'upload-1', 'upload')
    recorder.beginNode('message', 'upload-2', 'upload')
    now = 110
    recorder.endNode('upload-1', 'success')
    recorder.endNode('upload-2', 'failed')
    recorder.finish('message', 'failed')
    const result = projectTaskTiming([...spans.values()], query, new Set())
    expect(result.tasks[0]).toMatchObject({ taskId: 'message', durationMs: 110, status: 'failed' })
    expect(result.nodes.filter((n) => n.name === 'upload').map((n) => [n.durationMs, n.status])).toEqual(
      expect.arrayContaining([
        [100, 'success'],
        [100, 'failed']
      ])
    )
    expect(result.nodes.find((n) => n.name === 'agent.queue')?.durationMs).toBe(10)
    expect(projectTaskTiming([...spans.values()], query, new Set())).toEqual(result)
  })

  it('shares an explicit execution between coalesced inputs and retains late child ownership', () => {
    const spans = new Map<string, SpanEntity>()
    const recorder = new TaskTimingRecorder((span) => spans.set(span.id, structuredClone(span)))
    recorder.begin('agent-session:a', 'trace', 'input-a')
    recorder.begin('agent-session:a', 'trace', 'input-b')
    recorder.linkTasks(['input-a', 'input-b'])
    recorder.beginNode('input-a', 'child', 'subagent')
    recorder.finish('input-a', 'success')
    recorder.finish('input-b', 'success')
    recorder.begin('agent-session:a', 'trace', 'new-input')
    expect(recorder.beginChild('child', 'late-call', 'upload')).toBe(true)
    recorder.endNode('late-call', 'success')
    recorder.endNode('child', 'success')
    const original = projectTaskTiming([...spans.values()], { ...query, taskId: 'input-b' }, new Set())
    expect(original.nodes.some((node) => node.name === 'upload')).toBe(true)
    const next = projectTaskTiming([...spans.values()], { ...query, taskId: 'new-input' }, new Set())
    expect(next.nodes.some((node) => node.name === 'upload')).toBe(false)
  })

  it('leaves crash-orphaned nodes incomplete without inventing end times', () => {
    const spans: SpanEntity[] = []
    const recorder = new TaskTimingRecorder((span) => {
      const index = spans.findIndex((old) => old.id === span.id)
      if (index >= 0) spans[index] = structuredClone(span)
      else spans.push(structuredClone(span))
    })
    recorder.begin('agent-session:a', 'trace', 'message')
    const result = projectTaskTiming(spans, query, new Set())
    expect(result.tasks[0]).toMatchObject({
      status: 'interrupted',
      endTime: null,
      durationMs: null,
      completeness: 'incomplete'
    })
    expect(result.availability).toBe('incomplete')
  })

  it('never attributes an overlapping unlinked span to a task or returns captured content', () => {
    const spans = new Map<string, SpanEntity>()
    const recorder = new TaskTimingRecorder((span) => spans.set(span.id, structuredClone(span)))
    recorder.begin('agent-session:a', 'trace', 'message')
    recorder.finish('message', 'success')
    const task = [...spans.values()][0]
    const secretSpan: SpanEntity = {
      ...task,
      id: 'unlinked',
      parentId: '',
      attributes: { inputs: 'secret', authorization: 'secret' },
      events: [{ name: 'secret', time: [0, 0], attributes: { body: 'secret' } }]
    }
    const sanitized = timingOnlySpan(secretSpan)
    expect(JSON.stringify(sanitized)).not.toContain('secret')
    const result = projectTaskTiming([...spans.values(), secretSpan], query, new Set())
    expect(result.nodes.some((n) => n.id === 'unlinked')).toBe(false)
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(
      projectTaskTiming([...spans.values()], { ...query, taskId: 'another-session' }, new Set()).availability
    ).toBe('unavailable')
  })

  it('uses stable node ids for concurrent calls and paginates without duplicating tasks', () => {
    const spans = new Map<string, SpanEntity>()
    const recorder = new TaskTimingRecorder((span) => spans.set(span.id, structuredClone(span)))
    recorder.begin('agent-session:a', 'trace', 'message')
    recorder.beginNode('message', 'call', 'upload')
    recorder.beginNode('message', 'call', 'upload')
    recorder.endNode('call', 'success')
    recorder.finish('message', 'success')
    const first = projectTaskTiming([...spans.values()], { ...query, limit: 2 }, new Set())
    const second = projectTaskTiming([...spans.values()], { ...query, limit: 2, offset: first.nextOffset! }, new Set())
    expect(new Set([...first.nodes, ...second.nodes].map((n) => n.id)).size).toBe(3)
    expect(second.nextOffset).toBeNull()
  })
})
