import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { taskMethods } from '@cherrystudio/remote-protocol/agent'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { jobScheduleTable, jobTable } from '@data/db/schemas/job'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentTaskService } from '@data/services/AgentTaskService'
import { jobScheduleService } from '@data/services/JobScheduleService'

import { PAGE_ITEM_BYTES } from '../agentPagination'
import { sha256 } from '../agentQueries'
import { getTask, getTaskRun, listTasks, listTaskRuns, readTaskContent } from '../agentTaskQueries'

describe('remote task queries', () => {
  const dbh = setupTestDatabase()
  beforeEach(() => {
    for (const id of ['owner', 'other'])
      dbh.db
        .insert(agentTable)
        .values({
          id,
          type: 'claude-code',
          name: id,
          instructions: '',
          orderKey: id
        })
        .run()
  })
  function task(name: string, prompt = 'Summarize', agentId = 'owner') {
    return jobScheduleService.create({
      type: 'agent.task',
      name,
      trigger: { kind: 'interval', ms: 60_000 },
      jobInputTemplate: { agentId, prompt, timeoutMinutes: 2, workspace: { type: 'system' } },
      catchUpPolicy: { kind: 'skip-missed' }
    })
  }
  function run(taskId: string, id: string, values: Partial<typeof jobTable.$inferInsert> = {}) {
    dbh.db
      .insert(jobTable)
      .values({
        id,
        type: 'agent.task',
        scheduleId: taskId,
        status: 'completed',
        queue: 'agent:owner',
        scheduledAt: 1000,
        createdAt: 1000,
        finishedAt: 2000,
        input: {},
        ...values
      })
      .run()
  }

  it('filters business visibility before paging and binds cursors to normalized filters', () => {
    const a = task('a')
    const b = task('b')
    task('heartbeat', '__heartbeat__')
    task('missing', 'secret', 'missing')
    task('trashed', 'secret', 'other')
    jobScheduleService.update(a.id, { enabled: false })
    jobScheduleService.update(b.id, { enabled: false })
    dbh.db.update(agentTable).set({ deletedAt: Date.now() }).where(eq(agentTable.id, 'other')).run()
    dbh.db.update(jobScheduleTable).set({ createdAt: 1000 }).run()
    const first = listTasks({ agentId: 'owner', statuses: ['paused', 'active'], limit: 1 })
    const second = listTasks({
      agentId: 'owner',
      statuses: ['active', 'paused', 'paused'],
      limit: 1,
      cursor: first.nextCursor!
    })
    expect([...first.items, ...second.items].map((item) => item.taskId)).toEqual([a.id, b.id].sort().reverse())
    expect(second.nextCursor).toBeNull()
    expect(listTasks({ agentId: 'missing' })).toEqual({ items: [], nextCursor: null })
    expect(() => listTasks({ statuses: ['paused'], cursor: first.nextCursor! })).toThrow('Invalid task page cursor')
    expect(() => listTaskRuns({ taskId: a.id, cursor: first.nextCursor! })).toThrow('Invalid task page cursor')
    expect(() => listTasks({ cursor: 'garbage' })).toThrow('Invalid task page cursor')
  })

  it('exposes the current schedule and business update time in both list and detail', () => {
    const source = task('schedule')
    expect(listTasks({}).items[0].trigger).toEqual({ kind: 'interval', ms: 60_000 })
    const trigger = { kind: 'cron', expr: '0 9 * * *', timezone: 'Asia/Shanghai', limit: 3 } as const
    jobScheduleService.update(source.id, { trigger })
    dbh.db.update(jobScheduleTable).set({ updatedAt: 2000 }).where(eq(jobScheduleTable.id, source.id)).run()
    const expected = { taskId: source.id, trigger, updatedAt: '1970-01-01T00:00:02.000Z' }
    expect(listTasks({}).items[0]).toMatchObject(expected)
    expect(getTask(source.id)).toMatchObject(expected)
    taskMethods['agent.tasks.list'].result.parse(listTasks({}))
  })

  it('advances by the number actually returned when the byte budget shortens task pages', () => {
    const ids = Array.from({ length: 100 }, (_, i) => task(`${'界'.repeat(195)}${i}`).id)
    const found: string[] = []
    let cursor: string | undefined
    do {
      const page = listTasks({ limit: 100, cursor })
      taskMethods['agent.tasks.list'].result.parse(page)
      expect(Buffer.byteLength(JSON.stringify(page.items))).toBeLessThanOrEqual(PAGE_ITEM_BYTES + 2)
      found.push(...page.items.map((item) => item.taskId))
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    expect(found).toHaveLength(ids.length)
    expect(new Set(found)).toEqual(new Set(ids))
  })

  it('round-trips UTF-8 prompt chunks and expires old references even within the same millisecond', () => {
    const prompt = '你好🚀'.repeat(2048)
    const source = task('long prompt', prompt)
    const detail = getTask(source.id)
    taskMethods['agent.tasks.get'].result.parse({ task: detail })
    if (!('ref' in detail.prompt)) throw new Error('Long prompt must use a reference')
    const ref = detail.prompt.ref
    const chunks: Buffer[] = []
    let offset = '0'
    for (;;) {
      const part = readTaskContent({
        taskId: source.id,
        contentId: ref.contentId,
        revision: ref.revision,
        offset,
        maxBytes: 1023
      })
      taskMethods['agent.tasks.content.read'].result.parse(part)
      chunks.push(Buffer.from(part.dataBase64, 'base64'))
      expect(part.sha256).toBe(ref.sha256)
      offset = part.nextOffset
      if (part.eof) break
    }
    expect(Buffer.concat(chunks).toString('utf8')).toBe(prompt)
    expect(sha256(Buffer.concat(chunks))).toBe(ref.sha256)
    expect(offset).toBe(ref.byteLength)
    const read = { taskId: source.id, contentId: ref.contentId, revision: ref.revision, offset: '0', maxBytes: 1023 }
    expect(() => readTaskContent({ ...read, offset: '9999999999999999999999' })).toThrow(
      'Offset exceeds content length'
    )
    dbh.db
      .update(jobScheduleTable)
      .set({
        jobInputTemplate: {
          agentId: 'owner',
          prompt: `${prompt}!`,
          timeoutMinutes: 2,
          workspace: { type: 'system' }
        }
      })
      .where(eq(jobScheduleTable.id, source.id))
      .run()
    expect(() => readTaskContent(read)).toThrow('Task prompt changed')
    expect(getTask(source.id).prompt).not.toEqual(detail.prompt)
    expect(getTask(task('inline', 'x'.repeat(4096)).id).prompt).toEqual({ text: 'x'.repeat(4096) })
  })

  it('bounds legacy summaries at Unicode boundaries and never serializes unknown output', () => {
    const source = task('summaries')
    run(source.id, 'long', { output: { result: `${'x'.repeat(198)}🚀tail` } })
    run(source.id, 'split', { output: { result: `${'x'.repeat(199)}🚀tail` } })
    run(source.id, 'malformed', { output: { result: 'old\uD83Dtext' } })
    run(source.id, 'raw', { output: { result: { token: 'private' }, other: 'private' } })
    run(source.id, 'absent')
    expect(getTaskRun(source.id, 'long').summary).toBe(`${'x'.repeat(198)}🚀`)
    expect(getTaskRun(source.id, 'split').summary).toBe('x'.repeat(199))
    expect(getTaskRun(source.id, 'malformed').summary).toBe('old\uFFFDtext')
    expect(getTaskRun(source.id, 'raw').summary).toBeNull()
    expect(getTaskRun(source.id, 'absent').summary).toBeNull()
    const page = listTaskRuns({ taskId: source.id })
    taskMethods['agent.tasks.runs.list'].result.parse(page)
    expect(JSON.stringify(page)).not.toContain('private')
  })

  it('projects actual run states and verifies saved and legacy result locations against the owning Agent', () => {
    const source = task('runs')
    const readable = agentSessionService.create({ agentId: 'owner', name: 'result', workspace: { type: 'system' } })
    const background = agentSessionService.create(
      { agentId: 'owner', name: 'hidden', workspace: { type: 'system' } },
      'background'
    )
    const foreign = agentSessionService.create({ agentId: 'other', name: 'foreign', workspace: { type: 'system' } })
    run(source.id, 'running', {
      status: 'running',
      startedAt: 1500,
      finishedAt: null,
      cancelRequested: true,
      metadata: { sessionId: readable.id }
    })
    run(source.id, 'delayed', { status: 'delayed', finishedAt: null, attempt: 2, cancelRequested: false })
    run(source.id, 'legacy', { output: { sessionId: readable.id, result: 'legacy', kind: 'executed' } })
    run(source.id, 'skipped', { output: { kind: 'skipped', result: 'done' } })
    run(source.id, 'unknown', { output: { result: 'skipped is only text' } })
    run(source.id, 'foreign', { metadata: { sessionId: foreign.id }, output: { sessionId: readable.id } })
    run(source.id, 'background', { metadata: { sessionId: background.id } })
    run(source.id, 'failed', {
      status: 'failed',
      error: {
        code: 'E',
        message: 'Failure in /Users/private/secret.txt',
        retryable: false,
        params: { token: 'secret' }
      }
    })
    expect(getTaskRun(source.id, 'running')).toMatchObject({
      status: 'running',
      cancelRequested: true,
      startedAt: new Date(1500).toISOString(),
      resultLocation: { kind: 'session', sessionId: readable.id }
    })
    expect(getTaskRun(source.id, 'delayed')).toMatchObject({
      status: 'queued',
      startedAt: null,
      resultLocation: { kind: 'none' }
    })
    expect(getTaskRun(source.id, 'legacy')).toMatchObject({
      outcome: 'executed',
      summary: 'legacy',
      resultLocation: { kind: 'session', sessionId: readable.id }
    })
    expect(getTaskRun(source.id, 'skipped')).toMatchObject({ outcome: 'skipped', summary: 'done', startedAt: null })
    expect(getTaskRun(source.id, 'unknown')).toMatchObject({ outcome: 'unknown', summary: 'skipped is only text' })
    for (const id of ['foreign', 'background'])
      expect(getTaskRun(source.id, id).resultLocation).toEqual({ kind: 'unavailable' })
    const failed = getTaskRun(source.id, 'failed')
    expect(failed).toMatchObject({ status: 'failed', startedAt: null, failure: { retryable: false } })
    expect(JSON.stringify(failed)).not.toMatch(/secret|params|input|output/)
    const first = listTaskRuns({ taskId: source.id, limit: 5 })
    const second = listTaskRuns({ taskId: source.id, limit: 5, cursor: first.nextCursor! })
    expect([...first.items, ...second.items].map((item) => item.runId)).toEqual([
      'unknown',
      'skipped',
      'running',
      'legacy',
      'foreign',
      'failed',
      'delayed',
      'background'
    ])
    taskMethods['agent.tasks.runs.list'].result.parse(first)
    taskMethods['agent.tasks.runs.list'].result.parse(second)
    dbh.db.update(agentSessionTable).set({ deletedAt: Date.now() }).where(eq(agentSessionTable.id, readable.id)).run()
    expect(agentTaskService.getTaskRun(source.id, 'legacy').resultLocation).toEqual({ kind: 'unavailable' })
    expect(() => getTaskRun(task('unrelated').id, 'running')).toThrow('Resource not found')
  })
})
