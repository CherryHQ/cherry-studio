import type { PrepareProgressPartData } from '@shared/ai/agentPrepareTimeline'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
  }
}))

const { PrepareTimelineRecorder } = await import('../PrepareTimelineRecorder')

function makeRecorder(now: number) {
  const updates: PrepareProgressPartData[] = []
  const recorder = new PrepareTimelineRecorder(
    { sessionId: 's1', agentId: 'a1', runtimeType: 'claude-code', onStage: (u) => updates.push(u) },
    now
  )
  return { recorder, updates }
}

describe('PrepareTimelineRecorder', () => {
  it('tiles stages contiguously so totalMs is the sum of stage durations', () => {
    const { recorder } = makeRecorder(1000)
    recorder.recordDispatch(50)
    recorder.begin('mcp-warm', { serverCount: 2 }, 1000)
    recorder.begin('spawn-to-init', undefined, 1300) // closes mcp-warm at 300ms
    recorder.begin('init-to-first-chunk', undefined, 1900) // closes spawn-to-init at 600ms
    const timeline = recorder.finalize(2100) // closes init-to-first-chunk at 200ms

    expect(timeline).toBeDefined()
    expect(timeline?.stages.map((s) => [s.stage, s.ms])).toEqual([
      ['dispatch', 50],
      ['mcp-warm', 300],
      ['spawn-to-init', 600],
      ['init-to-first-chunk', 200]
    ])
    expect(timeline?.totalMs).toBe(1150)
    expect(timeline?.runtimeType).toBe('claude-code')
  })

  it('emits a coarse phase as each stage opens and finalizes with the timeline', () => {
    const { recorder, updates } = makeRecorder(0)
    recorder.begin('workspace', undefined, 0)
    recorder.begin('mcp-warm', { mcpServerName: 'filesystem' }, 100)
    recorder.begin('init-to-first-chunk', undefined, 400)
    recorder.finalize(900)

    expect(updates.map((u) => u.phase)).toEqual([
      'starting-runtime',
      'connecting-mcp',
      'waiting-first-response',
      'waiting-first-response'
    ])
    // Only the connecting-mcp update carries the server name.
    expect(updates[1].mcpServerName).toBe('filesystem')
    expect(updates[0].mcpServerName).toBeUndefined()
    // The finalized update carries the full breakdown; the live ones do not.
    // workspace 100 + mcp-warm 300 + init-to-first-chunk 500 = 900.
    expect(updates.at(-1)?.timeline?.totalMs).toBe(900)
    expect(updates[0].timeline).toBeUndefined()
  })

  it('patch merges detail into the open stage and re-emits the label', () => {
    const { recorder, updates } = makeRecorder(0)
    recorder.begin('mcp-warm', { serverCount: 1 }, 0)
    recorder.patch({ mcpServerName: 'filesystem', completedInTime: true })
    const timeline = recorder.finalize(200)

    expect(timeline?.stages[0].detail).toEqual({ serverCount: 1, mcpServerName: 'filesystem', completedInTime: true })
    expect(updates.some((u) => u.mcpServerName === 'filesystem')).toBe(true)
  })

  it('is idempotent and ignores mutations after finalize', () => {
    const { recorder } = makeRecorder(0)
    recorder.begin('spawn-to-init', undefined, 0)
    const first = recorder.finalize(100)
    const second = recorder.finalize(500)
    recorder.begin('init-to-first-chunk', undefined, 600)

    expect(first?.totalMs).toBe(100)
    expect(second).toBeUndefined()
    expect(recorder.isFinalized).toBe(true)
    expect(first?.stages).toHaveLength(1)
  })

  it('records MCP server names on the finalized timeline', () => {
    const { recorder } = makeRecorder(0)
    recorder.setMcpServerNames(['filesystem', 'memory'])
    recorder.begin('spawn-to-init', undefined, 0)
    const timeline = recorder.finalize(100)

    expect(timeline?.mcpServerNames).toEqual(['filesystem', 'memory'])
  })

  it('ignores a non-positive dispatch span (a prime connect with no waiting turn)', () => {
    const { recorder } = makeRecorder(0)
    recorder.recordDispatch(0)
    recorder.begin('spawn-to-init', undefined, 0)
    const timeline = recorder.finalize(100)

    expect(timeline?.stages.map((s) => s.stage)).toEqual(['spawn-to-init'])
  })
})
