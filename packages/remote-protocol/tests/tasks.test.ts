import { describe, expect, it } from 'vitest'

import { agentMethods, taskDetailSchema, taskRunSchema, taskSummarySchema } from '../src/agent'

const time = '2026-11-12T00:00:00.000Z'
const run = {
  runId: 'run',
  taskId: 'task',
  createdAt: time,
  scheduledAt: time,
  summary: null,
  resultLocation: { kind: 'none' }
}

describe('Task public contract', () => {
  it('rejects invalid filters, unbounded reads and private request fields', () => {
    const list = agentMethods['agent.tasks.list'].params
    expect(list.safeParse({ statuses: [] }).success).toBe(false)
    expect(list.safeParse({ statuses: ['running'] }).success).toBe(false)
    expect(list.safeParse({ includeHeartbeat: true }).success).toBe(false)
    expect(list.safeParse({ limit: 101 }).success).toBe(false)
    expect(list.safeParse({ cursor: 'x'.repeat(257) }).success).toBe(false)
    const content = { taskId: 'task', contentId: 'prompt', revision: '1', offset: '0', maxBytes: 24_576 }
    const read = agentMethods['agent.tasks.content.read'].params
    expect(read.safeParse(content).success).toBe(true)
    expect(read.safeParse({ ...content, maxBytes: 24_577 }).success).toBe(false)
    expect(read.safeParse({ ...content, offset: '-1' }).success).toBe(false)
    expect(read.safeParse({ ...content, path: '/private/file' }).success).toBe(false)
  })

  it('requires real run facts without treating cancellation requests or queue times as completion', () => {
    const queued = { ...run, status: 'queued', startedAt: null, cancelRequested: true }
    expect(taskRunSchema.safeParse(queued).success).toBe(true)
    expect(taskRunSchema.safeParse({ ...queued, startedAt: time }).success).toBe(false)
    expect(taskRunSchema.safeParse({ ...run, status: 'running', startedAt: time }).success).toBe(false)
    const terminal = { ...run, startedAt: null, finishedAt: time }
    expect(taskRunSchema.safeParse({ ...terminal, status: 'completed' }).success).toBe(false)
    expect(taskRunSchema.safeParse({ ...terminal, status: 'completed', outcome: 'skipped' }).success).toBe(true)
    expect(taskRunSchema.safeParse({ ...terminal, status: 'failed' }).success).toBe(false)
    expect(taskRunSchema.safeParse({ ...terminal, status: 'cancelled' }).success).toBe(true)
  })

  it('keeps task results extensible while preserving required detail and content bounds', () => {
    const detail = {
      taskId: 'task',
      agentId: 'agent',
      name: 'Report',
      status: 'active',
      nextRunAt: null,
      createdAt: time,
      updatedAt: time,
      prompt: { text: 'Summarize' },
      trigger: { kind: 'interval', ms: 60_000 },
      timeoutMinutes: 2,
      workspace: { kind: 'system' },
      reuse: { kind: 'fresh' },
      futureField: true
    }
    expect(taskDetailSchema.safeParse(detail).success).toBe(true)
    expect(taskSummarySchema.safeParse(detail).success).toBe(true)
    expect(taskSummarySchema.safeParse({ ...detail, trigger: undefined }).success).toBe(false)
    expect(taskSummarySchema.safeParse({ ...detail, updatedAt: undefined }).success).toBe(false)
    expect(taskDetailSchema.safeParse({ ...detail, prompt: { text: 'x'.repeat(4097) } }).success).toBe(false)
    expect(taskDetailSchema.safeParse({ ...detail, trigger: { kind: 'cron' } }).success).toBe(false)
    expect(taskDetailSchema.safeParse({ ...detail, reuse: { kind: 'reuse' } }).success).toBe(false)
  })

  it('bounds display summaries without permitting broken Unicode', () => {
    const completed = { ...run, status: 'completed', outcome: 'executed', startedAt: time, finishedAt: time }
    expect(taskRunSchema.safeParse({ ...completed, summary: '🚀'.repeat(100) }).success).toBe(true)
    expect(taskRunSchema.safeParse({ ...completed, summary: 'x'.repeat(201) }).success).toBe(false)
    expect(taskRunSchema.safeParse({ ...completed, summary: '\uD83D' }).success).toBe(false)
  })
})
