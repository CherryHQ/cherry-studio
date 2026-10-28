import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { HookInput, SyncHookJSONOutput } from '@anthropic-ai/claude-agent-sdk'
import type { BeforeAgentStartEvent, ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PromptBuilder } from '@main/ai/agents/prompt'

import { CLAUDE_IDENTITY_HOOK_SLOTS, CLAUDE_IDENTITY_NOMINAL_CAPACITY_UNITS } from './claudeCode/identityChunks'
import { createClaudeCodeIdentityHooks } from './claudeCode/identityHooks'
import { createPiIdentityExtension } from './pi/identityExtension'

describe('Live Agent identity', () => {
  let root: string
  const builder = new PromptBuilder()

  beforeEach(async () => {
    mockMainLoggerService.warn.mockClear()
    root = await mkdtemp(path.join(os.tmpdir(), 'cherry-identity-'))
    await mkdir(path.join(root, 'memory'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  async function writeIdentity(revision: string) {
    await writeFile(path.join(root, 'SOUL.md'), `Persona ${revision}`)
    await writeFile(path.join(root, 'USER.md'), `User ${revision}`)
    await writeFile(path.join(root, 'memory', 'FACT.md'), `Fact ${revision}`)
  }

  async function runClaudeEvent(
    hooks: ReturnType<typeof createClaudeCodeIdentityHooks>,
    event: 'UserPromptSubmit' | 'SessionStart' = 'UserPromptSubmit',
    source = 'startup',
    signal?: AbortSignal,
    extra: Record<string, unknown> = {}
  ) {
    const outputs = await Promise.all(
      hooks[event]![0].hooks.map((callback) => {
        const controller = new AbortController()
        if (signal?.aborted) controller.abort()
        signal?.addEventListener('abort', () => controller.abort(), { once: true })
        return callback({ hook_event_name: event, session_id: 'session', source, ...extra } as HookInput, undefined, {
          signal: controller.signal
        }) as Promise<SyncHookJSONOutput>
      })
    )
    if (outputs.every((output) => Object.keys(output).length === 0)) {
      expect(outputs).toEqual(Array.from({ length: CLAUDE_IDENTITY_HOOK_SLOTS }, () => ({})))
      return { snapshot: undefined, outputs, contexts: [] as string[] }
    }
    const contexts = outputs.flatMap((result) => {
      if (!result.hookSpecificOutput) {
        expect(result).toEqual({})
        return []
      }
      expect(result.hookSpecificOutput.hookEventName).toBe(event)
      expect(result.hookSpecificOutput).toHaveProperty('additionalContext')
      return [(result.hookSpecificOutput as { additionalContext: string }).additionalContext]
    })
    const parts = contexts.map((context) => {
      expect(context.length).toBeLessThanOrEqual(10_000)
      const header =
        /^<agent_identity_part batch="([^"]+)" part="(\d+)\/(\d+)" units="(\d+)" truncated="(true|false)">\n/.exec(
          context
        )!
      expect(header).not.toBeNull()
      const start = context.indexOf('part is not a complete snapshot.\n') + 'part is not a complete snapshot.\n'.length
      const end = start + Number(header[4])
      expect(context.slice(end)).toMatch(
        header[5] === 'true' && Number(header[2]) === Number(header[3])
          ? /^\n<identity_overflow [\s\S]+\n<\/agent_identity_part>$/
          : /^\n<\/agent_identity_part>$/
      )
      return { batch: header[1], number: Number(header[2]), total: Number(header[3]), body: context.slice(start, end) }
    })
    expect(new Set(parts.map((part) => part.batch)).size).toBe(1)
    const numbers = parts.map((part) => part.number)
    expect(new Set(numbers).size).toBe(numbers.length)
    expect(numbers.toSorted((a, b) => a - b)).toEqual(Array.from({ length: parts[0].total }, (_, i) => i + 1))
    for (const part of parts) expect(part.total).toBe(parts.length)
    return {
      snapshot: parts
        .toSorted((a, b) => a.number - b.number)
        .map((part) => part.body)
        .join(''),
      outputs,
      contexts
    }
  }

  function claudeConnection() {
    const hooks = createClaudeCodeIdentityHooks(root)
    return async (
      event: 'UserPromptSubmit' | 'SessionStart' = 'UserPromptSubmit',
      source = 'startup',
      signal?: AbortSignal
    ) => (await runClaudeEvent(hooks, event, source, signal)).snapshot
  }

  it('keeps mutable file contents out of the connection-lifetime prompt', async () => {
    await writeIdentity('A')
    const { context } = await builder.buildPromptParts(root, { bootstrap_completed: true })
    expect(context).toContain(path.join(root, 'SOUL.md'))
    expect(context).not.toContain('Persona A')
    expect(context).not.toContain('User A')
    expect(context).not.toContain('Fact A')
  })

  it('refreshes created, modified, cleared and deleted files on one Claude connection', async () => {
    const submit = claudeConnection()
    expect(await submit()).toContain('<soul>\n\n</soul>')
    await writeIdentity('A')
    expect(await submit()).toContain('Persona A')
    await writeIdentity('B')
    const modified = await submit()
    expect(modified).toContain('Persona B')
    expect(modified).toContain('User B')
    expect(modified).toContain('Fact B')
    expect(modified).not.toContain('Persona A')
    expect(await submit()).toBeUndefined()
    await writeFile(path.join(root, 'SOUL.md'), '')
    await rm(path.join(root, 'USER.md'))
    await rm(path.join(root, 'memory', 'FACT.md'))
    const deleted = await submit()
    expect(deleted).toContain('replaces all earlier snapshots')
    expect(deleted).toContain('<soul>\n\n</soul>')
    expect(deleted).toContain('<user>\n\n</user>')
    expect(deleted).toContain('<facts>\n\n</facts>')
    expect(deleted).not.toContain('Persona B')
    expect(deleted).not.toContain('User B')
    expect(deleted).not.toContain('Fact B')
  })

  it.each(['startup', 'resume', 'compact', 'clear', 'fork'])('rehydrates Claude identity on %s', async (source) => {
    await writeIdentity('A')
    const submit = claudeConnection()
    expect(await submit()).toContain('Persona A')
    expect(await submit('SessionStart', source)).toContain('Persona A')
    expect(await submit()).toBeUndefined()
  })

  it('does not let one warm connection suppress updates for another', async () => {
    const first = claudeConnection()
    const second = claudeConnection()
    await writeIdentity('A')
    await first()
    await second()
    await writeIdentity('B')
    expect(await first()).toContain('Persona B')
    expect(await second()).toContain('Persona B')
  })

  it('does not mark an aborted hook snapshot as delivered', async () => {
    const submit = claudeConnection()
    await writeIdentity('A')
    const controller = new AbortController()
    controller.abort()
    expect(await submit('UserPromptSubmit', 'sdk', controller.signal)).toBeUndefined()
    expect(await submit()).toContain('Persona A')
  })

  it('detects a file rewrite even when its modification time is preserved', async () => {
    await writeIdentity('A')
    const file = path.join(root, 'SOUL.md')
    const timestamp = new Date('2026-01-01T00:00:00Z')
    await utimes(file, timestamp, timestamp)
    const before = await stat(file)
    expect(await builder.buildMemoriesSection(root)).toContain('Persona A')
    await writeFile(file, 'Persona B with a changed length')
    await utimes(file, before.atime, before.mtime)
    expect(await builder.buildMemoriesSection(root)).toContain('Persona B with a changed length')
  })

  it('delivers a long Chinese identity exactly once per batch and leaves spare slots empty', async () => {
    await writeIdentity('LONG')
    await writeFile(path.join(root, 'memory', 'FACT.md'), '中'.repeat(30_000) + '尾部')
    const expected = await builder.buildMemoriesSection(root)
    const read = vi.spyOn(PromptBuilder.prototype, 'buildMemoriesSection')
    const result = await runClaudeEvent(createClaudeCodeIdentityHooks(root))
    expect(result.snapshot).toBe(expected)
    expect(read).toHaveBeenCalledTimes(1)
    expect(result.contexts.length).toBeGreaterThan(1)
    expect(result.outputs.slice(result.contexts.length)).toEqual(
      Array.from({ length: 16 - result.contexts.length }, () => ({}))
    )
  })

  it('reports overflow without logging identity, deduplicates warnings, and compares omitted content', async () => {
    await writeIdentity('OVERFLOW')
    const fact = 'PRIVATE_FACT_22945' + '中'.repeat(180_000)
    const file = path.join(root, 'memory', 'FACT.md')
    await writeFile(file, fact + 'A')
    const hooks = createClaudeCodeIdentityHooks(root)
    const expected = await builder.buildMemoriesSection(root)
    const first = await runClaudeEvent(hooks)
    expect(first.contexts).toHaveLength(16)
    expect(expected.startsWith(first.snapshot!)).toBe(true)
    expect(first.snapshot!.length).toBeLessThan(expected.length)
    expect(first.contexts.every((c) => c.includes('truncated="true"'))).toBe(true)
    const omitted = expected.length - first.snapshot!.length
    const last = first.contexts.at(-1)!
    expect(last).toContain(`snapshotUnits="${expected.length}"`)
    expect(last).toContain(`deliveredUnits="${first.snapshot!.length}"`)
    expect(last).toContain(`omittedUnits="${omitted}"`)
    for (const file of ['SOUL.md', 'USER.md', 'memory/FACT.md']) expect(last).toContain(path.join(root, file))
    expect(last).toContain('Omitted content is unknown. Do not fill it from any earlier snapshot.')
    expect(mockMainLoggerService.warn).toHaveBeenCalledExactlyOnceWith(
      'Claude Code identity exceeds hook delivery capacity',
      {
        event: 'UserPromptSubmit',
        snapshotUnits: expected.length,
        nominalCapacityUnits: CLAUDE_IDENTITY_NOMINAL_CAPACITY_UNITS,
        deliveredUnits: first.snapshot!.length,
        omittedUnits: omitted,
        hookSlots: 16
      }
    )
    expect(JSON.stringify(mockMainLoggerService.warn.mock.calls)).not.toContain('PRIVATE_FACT_22945')
    expect((await runClaudeEvent(hooks)).snapshot).toBeUndefined()
    expect((await runClaudeEvent(hooks, 'SessionStart')).snapshot).toBe(first.snapshot)
    expect((await runClaudeEvent(hooks, 'SessionStart')).snapshot).toBe(first.snapshot)
    expect(mockMainLoggerService.warn).toHaveBeenCalledTimes(1)
    await writeFile(file, fact + 'B')
    const changed = await runClaudeEvent(hooks)
    expect(changed.snapshot).toBe(first.snapshot)
    expect(changed.contexts).toHaveLength(16)
    expect(mockMainLoggerService.warn).toHaveBeenCalledTimes(2)
  })

  it('skips every subagent slot without consuming the main connection update', async () => {
    await writeIdentity('MAIN')
    const hooks = createClaudeCodeIdentityHooks(root)
    const read = vi.spyOn(PromptBuilder.prototype, 'buildMemoriesSection')
    expect(
      (await runClaudeEvent(hooks, 'UserPromptSubmit', 'startup', undefined, { agent_id: 'child' })).snapshot
    ).toBeUndefined()
    expect(read).not.toHaveBeenCalled()
    expect((await runClaudeEvent(hooks)).snapshot).toBe(await builder.buildMemoriesSection(root))
  })

  it('retries after cancellation during the shared read', async () => {
    await writeIdentity('ABORT')
    const snapshot = await builder.buildMemoriesSection(root)
    const started = Promise.withResolvers<void>()
    const reading = Promise.withResolvers<string>()
    vi.spyOn(PromptBuilder.prototype, 'buildMemoriesSection').mockImplementationOnce(() => {
      started.resolve()
      return reading.promise
    })
    const hooks = createClaudeCodeIdentityHooks(root)
    const controller = new AbortController()
    const pending = runClaudeEvent(hooks, 'UserPromptSubmit', 'sdk', controller.signal)
    await started.promise
    controller.abort()
    reading.resolve(snapshot)
    expect((await pending).snapshot).toBeUndefined()
    expect((await runClaudeEvent(hooks)).snapshot).toBe(snapshot)
  })

  it('keeps fixed slots without stale tails across small, large, and small snapshots', async () => {
    const hooks = createClaudeCodeIdentityHooks(root)
    for (const size of [3, 40_000, 4]) {
      await writeFile(path.join(root, 'memory', 'FACT.md'), 'f'.repeat(size))
      const expected = await builder.buildMemoriesSection(root)
      const result = await runClaudeEvent(hooks)
      expect(hooks.UserPromptSubmit![0].hooks).toHaveLength(16)
      expect(hooks.SessionStart![0].hooks).toHaveLength(16)
      expect(result.snapshot).toBe(expected)
      expect(result.contexts.length).toBe(size === 40_000 ? 6 : 1)
      expect(result.outputs.slice(result.contexts.length).every((o) => Object.keys(o).length === 0)).toBe(true)
    }
  })

  it('clears a failed shared read and never marks its snapshot delivered', async () => {
    await writeIdentity('RETRY')
    const hooks = createClaudeCodeIdentityHooks(root)
    vi.spyOn(PromptBuilder.prototype, 'buildMemoriesSection').mockRejectedValueOnce(new Error('read failed'))
    await expect(runClaudeEvent(hooks)).rejects.toThrow('read failed')
    expect((await runClaudeEvent(hooks)).snapshot).toBe(await builder.buildMemoriesSection(root))
  })

  it('does not let a late older batch overwrite a newer delivered snapshot', async () => {
    const oldRead = Promise.withResolvers<string>()
    vi.spyOn(PromptBuilder.prototype, 'buildMemoriesSection')
      .mockImplementationOnce(() => oldRead.promise)
      .mockResolvedValue('NEW')
    const hooks = createClaudeCodeIdentityHooks(root)
    const older = runClaudeEvent(hooks, 'UserPromptSubmit', 'sdk', undefined, { prompt_id: 'old' })
    await Promise.resolve()
    expect((await runClaudeEvent(hooks, 'UserPromptSubmit', 'sdk', undefined, { prompt_id: 'new' })).snapshot).toBe(
      'NEW'
    )
    oldRead.resolve('OLD')
    expect((await older).snapshot).toBe('OLD')
    expect((await runClaudeEvent(hooks)).snapshot).toBeUndefined()
  })

  it('does not suppress retries when the last slot aborts after earlier parts were returned', async () => {
    const snapshot = 'x'.repeat(30_000)
    vi.spyOn(PromptBuilder.prototype, 'buildMemoriesSection').mockResolvedValue(snapshot)
    const hooks = createClaudeCodeIdentityHooks(root)
    const callbacks = hooks.UserPromptSubmit![0].hooks
    const input = { hook_event_name: 'UserPromptSubmit', session_id: 'session' } as HookInput
    const prepared = await Promise.all(
      callbacks
        .slice(0, 15)
        .map((callback) => callback({ ...input }, undefined, { signal: new AbortController().signal }))
    )
    expect(prepared.filter((result) => 'hookSpecificOutput' in result)).toHaveLength(4)
    const cancelled = new AbortController()
    cancelled.abort()
    expect(await callbacks[15]({ ...input }, undefined, { signal: cancelled.signal })).toEqual({})
    expect((await runClaudeEvent(hooks)).snapshot).toBe(snapshot)
  })

  it('returns parts by logical slot even when callbacks are invoked in reverse order', async () => {
    const snapshot = 'x'.repeat(25_000) + '\n</agent_identity_part>\n😀'
    vi.spyOn(PromptBuilder.prototype, 'buildMemoriesSection').mockResolvedValue(snapshot)
    const hooks = createClaudeCodeIdentityHooks(root)
    hooks.UserPromptSubmit![0].hooks.reverse()
    const result = await runClaudeEvent(hooks)
    expect(result.snapshot).toBe(snapshot)
    expect(result.contexts).toHaveLength(3)
    expect(result.contexts[0]).toContain('part="3/3"')
    expect(result.contexts[2]).toContain('part="1/3"')
  })

  it('warns and retries without marking an unrepresentable overflow as delivered', async () => {
    vi.spyOn(PromptBuilder.prototype, 'buildMemoriesSection').mockResolvedValue('x'.repeat(200_000))
    const hooks = createClaudeCodeIdentityHooks('/' + '长'.repeat(4_000))
    expect((await runClaudeEvent(hooks)).snapshot).toBeUndefined()
    expect((await runClaudeEvent(hooks)).snapshot).toBeUndefined()
    expect(mockMainLoggerService.warn).toHaveBeenCalledTimes(2)
    expect(mockMainLoggerService.warn.mock.calls[0][1]).toEqual({
      event: 'UserPromptSubmit',
      snapshotUnits: 200_000,
      nominalCapacityUnits: 153_600,
      deliveredUnits: 0,
      omittedUnits: 200_000,
      hookSlots: 16
    })
  })

  it('updates only the Pi identity section before each turn', async () => {
    let beforeStart!: (event: BeforeAgentStartEvent) => Promise<void>
    const extension = createPiIdentityExtension(root)
    await extension({
      on: (event: string, handler: typeof beforeStart) => {
        if (event === 'before_agent_start') beforeStart = handler
      }
    } as ExtensionAPI)
    const event = {
      systemPromptOptions: { sections: { custom_role: 'Keep this role.' } }
    } as unknown as BeforeAgentStartEvent
    await writeIdentity('A')
    await beforeStart(event)
    expect(event.systemPromptOptions.sections.agent_identity).toContain('Persona A')
    await writeIdentity('B')
    await beforeStart(event)
    expect(event.systemPromptOptions.sections.agent_identity).toContain('Persona B')
    expect(event.systemPromptOptions.sections.agent_identity).not.toContain('Persona A')
    expect(event.systemPromptOptions.sections.custom_role).toBe('Keep this role.')
    await rm(path.join(root, 'SOUL.md'))
    await beforeStart(event)
    expect(event.systemPromptOptions.sections.agent_identity).toContain('<soul>\n\n</soul>')
  })
})
