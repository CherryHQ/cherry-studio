import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { CanUseTool, PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk'
import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { MemoryService } from '@main/ai/memory/MemoryService'
import { memorySearchTarget, memoryTarget } from '@main/ai/memory/memoryTarget'
import { BaseService } from '@main/core/lifecycle'

import { buildClaudeCodeHooks } from '../hooks'
import { ClaudeMemoryTools, CLAUDE_MEMORY_UNCONFIRMED, isClaudeMemoryWorkingCopy } from '../memoryTools'

describe('Claude native memory file adapter', () => {
  const dbh = setupTestDatabase()
  const agentId = randomUUID()
  const sessionId = randomUUID()
  const workspaceId = randomUUID()
  let directory: string
  let memory: MemoryService
  let tools: ClaudeMemoryTools
  let file: string
  let turnId: string
  let mode: 'default' | 'bypassPermissions' | 'plan'
  let disabled: boolean
  let approve: boolean
  let authorizationInputs: Record<string, unknown>[]
  let authorize: CanUseTool
  const signal = new AbortController().signal

  beforeEach(async () => {
    BaseService.resetInstances()
    directory = await mkdtemp(path.join(os.tmpdir(), 'claude-memory-test-'))
    vi.spyOn(application, 'getPath').mockImplementation((key, name) =>
      key === 'app.database.file' ? dbh.sqlite.name : path.join(directory, key, name ?? '')
    )
    turnId = randomUUID()
    mode = 'bypassPermissions'
    disabled = false
    approve = true
    authorizationInputs = []
    dbh.db
      .insert(agentTable)
      .values({ id: agentId, name: 'A', type: 'claude-code', instructions: '', orderKey: 'a0' })
      .run()
    dbh.db.insert(agentWorkspaceTable).values({ id: workspaceId, name: 'W', path: directory, orderKey: 'a0' }).run()
    dbh.db.insert(agentSessionTable).values({ id: sessionId, agentId, workspaceId, name: 'S', orderKey: 'a0' }).run()
    MockApplicationUtils.setService('AgentSessionRuntimeService', {
      getLiveAssistantMessageId: () => turnId,
      getInteractionState: () => ({ currentTurn: 'interactive', userResponse: 'stream' }),
      onTurnTerminal: () => ({ dispose() {} })
    })
    MockApplicationUtils.setService('ClaudeCodeSessionStateService', {
      getToolPolicySnapshot: () => ({ isDisabled: () => disabled, getPermissionMode: () => mode }),
      getMemoryTools: () => tools,
      peekMemoryTools: () => tools
    })
    MockApplicationUtils.setService('MemoryMigrationService', { ensureAgent: async () => true })
    memory = new MemoryService()
    MockApplicationUtils.setService('MemoryService', memory)
    authorize = async (_tool, input) => {
      authorizationInputs.push(input)
      return approve ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'Declined' }
    }
    tools = new ClaudeMemoryTools(sessionId, directory, authorize)
    await mkdir(application.getPath('app.userdata'), { recursive: true })
    await mkdir(application.getPath('feature.memory.data'), { recursive: true })
    await mkdir(application.getPath('feature.agents.data', agentId), { recursive: true })
    file = application.getPath('feature.memory.data', 'MEMORY.md')
    await writeFile(file, 'INITIAL\n')
  })

  async function removeFixture(dir: string): Promise<void> {
    if (dir !== directory && !dir.startsWith(`${directory}${path.sep}`)) throw new Error('Outside fixture')
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name)
      if (entry.isDirectory()) await removeFixture(target)
      else await unlink(target)
    }
    await rmdir(dir)
  }

  afterEach(async () => {
    await tools.dispose()
    await memory['_doStop']()
    vi.restoreAllMocks()
    MockApplicationUtils.resetServices()
    await removeFixture(directory)
  })

  async function begin(name: string, args: Record<string, unknown> = {}, callSignal = signal) {
    const input: PreToolUseHookInput = {
      hook_event_name: 'PreToolUse',
      session_id: 'native-session',
      transcript_path: '',
      cwd: directory,
      tool_use_id: randomUUID(),
      tool_name: name,
      tool_input: { file_path: file, ...args }
    }
    const updated = await tools.prepare(input, callSignal)
    return { input, updated: updated! }
  }

  async function read(offset?: number) {
    const call = await begin('Read', offset ? { offset } : {})
    const content = await readFile(call.updated.file_path as string, 'utf8')
    const result = await tools.complete(
      {
        ...call.input,
        hook_event_name: 'PostToolUse',
        tool_input: call.updated,
        tool_response: {
          type: 'text',
          file: { filePath: call.updated.file_path, content, startLine: offset ?? 1, numLines: 2, totalLines: 2 }
        }
      },
      signal
    )
    tools.release(call.input.tool_use_id)
    return { ...call, result }
  }

  async function finishWrite(call: Awaited<ReturnType<typeof begin>>, content: string) {
    await writeFile(call.updated.file_path as string, content)
    return tools.complete(
      {
        ...call.input,
        hook_event_name: 'PostToolUse',
        tool_input: call.updated,
        tool_response: { filePath: call.updated.file_path, content }
      },
      signal
    )
  }

  it('keeps native paths stable, commits two edits and produces recoverable backups', async () => {
    const first = await read()
    expect(first.result).toMatchObject({
      hookSpecificOutput: { updatedToolOutput: { file: { filePath: file, content: 'INITIAL\n' } } }
    })
    for (const content of ['FIRST\n', 'SECOND\n']) {
      const call = await begin('Edit', { old_string: 'old', new_string: 'new' })
      expect(call.updated.file_path).toBe(first.updated.file_path)
      const result = await finishWrite(call, content)
      expect(result).toMatchObject({ hookSpecificOutput: { updatedToolOutput: { filePath: file } } })
      expect(await readFile(file, 'utf8')).toBe(content)
      tools.release(call.input.tool_use_id)
    }
    expect(authorizationInputs.filter((input) => 'memoryPreview' in input)).toHaveLength(2)
    expect(authorizationInputs.at(-1)).toMatchObject({ file_path: file, memoryPreview: [{ content: 'SECOND\n' }] })
    expect((await readdir(application.getPath('feature.memory.backups'))).length).toBeGreaterThan(0)
  })

  it('creates a new memory topic through Write without exposing a new tool parameter', async () => {
    const target = application.getPath('feature.memory.data', '.memories/topic.md')
    const call = await begin('Write', { file_path: target, content: 'NEW\n' })
    expect(Object.keys(call.updated).sort()).toEqual(['content', 'file_path'])
    const result = await finishWrite(call, 'NEW\n')
    expect(result).toMatchObject({ hookSpecificOutput: { updatedToolOutput: { filePath: target } } })
    expect(await readFile(target, 'utf8')).toBe('NEW\n')
  })

  it('keeps consecutive native edits usable after a correction hides its history', async () => {
    const extraction = memory.open({ scope: { kind: 'shared' }, assertAuthorized: () => undefined }, 'extraction')
    const proposal = await extraction.prepareRevisions((await extraction.read('MEMORY.md')).receipt, [
      {
        quote: 'INITIAL',
        text: 'CURRENT',
        reason: 'corrected',
        recordedAt: '2026-11-17T10:00:00.000Z',
        sources: [{ kind: 'chat', conversationId: 't', messageId: 'm', sourceVersion: 'v' }]
      }
    ])
    await extraction.commit([proposal], async () => () => undefined)
    const first = await read()
    expect(JSON.stringify(first.result)).not.toContain('INITIAL')
    for (const text of ['First edit', 'Second edit']) {
      const call = await begin('Edit', { old_string: 'CURRENT', new_string: text })
      const result = await finishWrite(call, `- "CURRENT"\n- "${text}"\n`)
      expect(result).toMatchObject({ hookSpecificOutput: { updatedToolOutput: { filePath: file } } })
      tools.release(call.input.tool_use_id)
    }
    expect(await readFile(file, 'utf8')).toContain('retirement')
    expect(await extraction.revisions()).toHaveLength(1)
    extraction.dispose()
  })

  it('keeps working copies out of direct file tools and directory searches', async () => {
    const call = await read()
    const stage = call.updated.file_path as string
    await expect(memoryTarget(stage)).rejects.toThrow('working copies are internal')
    expect(await memorySearchTarget(path.dirname(stage))).toBe(true)
    expect(await memorySearchTarget(application.getPath('app.temp'))).toBe(true)
    expect(await memorySearchTarget(application.getPath('app.temp', 'unrelated'))).toBe(false)
    await expect(begin('Read', { file_path: stage })).rejects.toThrow('original memory path')
  })

  it('keeps an unapproved edit in the working copy and stops without claiming the original was saved', async () => {
    await read()
    const call = await begin('Write', { content: 'DECLINED\n' })
    approve = false
    const result = await finishWrite(call, 'DECLINED\n')
    expect(result).toMatchObject({ continue: false, decision: 'block', reason: CLAUDE_MEMORY_UNCONFIRMED })
    expect(result.hookSpecificOutput).not.toHaveProperty('updatedToolOutput')
    expect(isClaudeMemoryWorkingCopy(call.updated.file_path)).toBe(true)
    expect(await readFile(file, 'utf8')).toBe('INITIAL\n')
  })

  it('preserves an intervening change instead of committing a stale working copy', async () => {
    await read()
    const call = await begin('Write', { content: 'STALE\n' })
    await writeFile(file, 'NEWER\n')
    expect(await finishWrite(call, 'STALE\n')).toMatchObject({ continue: false, decision: 'block' })
    expect(await readFile(file, 'utf8')).toBe('NEWER\n')
  })

  it('requires complete reads and refuses overlapping operations on the same file', async () => {
    await read(2)
    await expect(begin('Write')).rejects.toThrow('complete')
    await read()
    const call = await begin('Edit')
    await expect(begin('Write')).rejects.toThrow('Another operation')
    tools.release(call.input.tool_use_id)
    await expect(begin('Edit')).rejects.toThrow('complete')
    expect(await readFile(file, 'utf8')).toBe('INITIAL\n')
  })

  it('rechecks the turn and shared permission before saving', async () => {
    await read()
    const call = await begin('Write')
    dbh.db
      .update(agentTable)
      .set({ configuration: { shared_memory_enabled: false } })
      .where(eq(agentTable.id, agentId))
      .run()
    expect(await finishWrite(call, 'REVOKED\n')).toMatchObject({ continue: false })
    expect(await readFile(file, 'utf8')).toBe('INITIAL\n')
  })

  it('does not reuse a read baseline from the previous turn', async () => {
    await read()
    turnId = randomUUID()
    await expect(begin('Write')).rejects.toThrow('Read this memory file completely')
  })

  it('respects plan mode, disabled tools and private ownership', async () => {
    await read()
    mode = 'plan'
    await expect(begin('Write')).rejects.toThrow('read-only')
    mode = 'bypassPermissions'
    disabled = true
    await expect(begin('Read')).rejects.toThrow('disabled')
    disabled = false
    const other = application.getPath('feature.agents.data', `${randomUUID()}/MEMORY.md`)
    await expect(begin('Read', { file_path: other })).rejects.toThrow('Another Agent')
  })

  it('withdraws read content if the file changed while the native Read was running', async () => {
    const call = await begin('Read')
    await writeFile(file, 'CHANGED\n')
    const result = await tools.complete(
      {
        ...call.input,
        hook_event_name: 'PostToolUse',
        tool_input: call.updated,
        tool_response: {
          type: 'text',
          file: { filePath: call.updated.file_path, content: 'INITIAL\n', startLine: 1, numLines: 2, totalLines: 2 }
        }
      },
      signal
    )
    expect(JSON.stringify(result)).not.toContain('INITIAL')
    expect(result).toMatchObject({
      continue: false,
      hookSpecificOutput: { updatedToolOutput: { file: { content: CLAUDE_MEMORY_UNCONFIRMED } } }
    })
  })

  it('routes a managed write through the actual native hooks and guard table', async () => {
    await read()
    const hooks = buildClaudeCodeHooks({
      sessionId,
      cwd: directory,
      agentDataPath: application.getPath('feature.agents.data', agentId),
      mountedServers: new Set(),
      pluginDirectories: new Map(),
      builtinRole: undefined,
      supportsImages: true,
      authorizeMemory: authorize
    })
    const input: PreToolUseHookInput = {
      hook_event_name: 'PreToolUse',
      session_id: 'native',
      transcript_path: '',
      cwd: directory,
      tool_use_id: randomUUID(),
      tool_name: 'Write',
      tool_input: { file_path: file, content: 'HOOK\n' }
    }
    const decision = await hooks!.PreToolUse![0].hooks[0](input, input.tool_use_id, { signal })
    expect(decision).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: expect.any(Object) }
    })
    if (!('hookSpecificOutput' in decision) || decision.hookSpecificOutput?.hookEventName !== 'PreToolUse')
      throw new Error('Missing rewrite')
    const updated = decision.hookSpecificOutput.updatedInput!
    await writeFile(updated.file_path as string, 'HOOK\n')
    const result = await hooks!.PostToolUse![0].hooks.at(-1)!(
      {
        ...input,
        hook_event_name: 'PostToolUse',
        tool_input: updated,
        tool_response: { filePath: updated.file_path, content: 'HOOK\n' }
      },
      input.tool_use_id,
      { signal }
    )
    expect(result).toMatchObject({ hookSpecificOutput: { updatedToolOutput: { filePath: file } } })
    expect(await readFile(file, 'utf8')).toBe('HOOK\n')
  })

  it('does not save a cancelled operation and removes its working copy on disposal', async () => {
    await read()
    const controller = new AbortController()
    const call = await begin('Write', { content: 'CANCELLED\n' }, controller.signal)
    controller.abort()
    expect(await finishWrite(call, 'CANCELLED\n')).toMatchObject({ continue: false })
    expect(await readFile(file, 'utf8')).toBe('INITIAL\n')
    await tools.dispose()
    await expect(readFile(call.updated.file_path as string)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a late old-turn result without unlocking a new-turn operation', async () => {
    const old = await begin('Read')
    turnId = randomUUID()
    const current = await begin('Read')
    const result = await tools.complete(
      {
        ...old.input,
        hook_event_name: 'PostToolUse',
        tool_input: old.updated,
        tool_response: {
          type: 'text',
          file: { filePath: old.updated.file_path, content: 'INITIAL\n', startLine: 1, numLines: 2, totalLines: 2 }
        }
      },
      signal
    )
    expect(result).toMatchObject({ continue: false })
    await expect(begin('Write')).rejects.toThrow('Another operation')
    tools.release(current.input.tool_use_id)
  })
})
