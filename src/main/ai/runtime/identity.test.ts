import { mkdir, mkdtemp, readFile, rename, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { HookInput, SyncHookJSONOutput } from '@anthropic-ai/claude-agent-sdk'
import type { BeforeAgentStartEvent, ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { Client } from '@modelcontextprotocol/client'
import { setupTestDatabase } from '@test-helpers/db'
import { connectMcpTestClient } from '@test-helpers/mcp/client'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentChannelSessionTable, agentChannelTable } from '@data/db/schemas/agentChannel'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { ensureAgentDataDirectory } from '@main/ai/agents/agentDataDirectory'
import { PromptBuilder } from '@main/ai/agents/prompt'
import { ensureUserMemory } from '@main/ai/agents/userMemory'
import { createAgentMemoryServer } from '@main/ai/mcp/servers/agentMemory'
import { memoryHandlers } from '@main/ipc/handlers/memory'

import { createClaudeCodeIdentityHooks } from './claudeCode/identityHooks'
import { createPiIdentityExtension } from './pi/identityExtension'

describe('Live Agent identity', () => {
  let root: string
  const builder = new PromptBuilder()

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'cherry-identity-'))
    await mkdir(path.join(root, 'memory'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function writeIdentity(revision: string) {
    await writeFile(path.join(root, 'SOUL.md'), `Persona ${revision}`)
    await writeFile(path.join(root, 'USER.md'), `User ${revision}`)
    await writeFile(path.join(root, 'memory', 'FACT.md'), `Fact ${revision}`)
  }

  function claudeConnection() {
    const hooks = createClaudeCodeIdentityHooks(root)
    return async (
      event: 'UserPromptSubmit' | 'SessionStart' = 'UserPromptSubmit',
      source = 'startup',
      signal = new AbortController().signal
    ) => {
      const result = (await hooks[event]![0].hooks[0]({ hook_event_name: event, source } as HookInput, undefined, {
        signal
      })) as SyncHookJSONOutput
      const output = result.hookSpecificOutput
      return output && 'additionalContext' in output ? output.additionalContext : undefined
    }
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

// Protect the cross-agent and runtime boundaries with production services and real files.
describe('Desktop shared memory', () => {
  const dbh = setupTestDatabase()
  const clients: Client[] = []
  let root: string
  let restorePaths: () => void
  let first: Client
  let second: Client

  type ToolResult = { isError?: boolean; content: Array<{ type: string; text?: string }> }
  const call = async (client: Client, args: Record<string, unknown>): Promise<ToolResult> =>
    client.callTool({ name: 'memory', arguments: args })
  const read = async (client: Client) =>
    JSON.parse((await call(client, { action: 'read', scope: 'user' })).content[0].text!)

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'shared-memory-'))
    const userPath = path.join(root, 'Memory')
    await mkdir(userPath)
    const original = application.getPath.bind(application)
    const spy = vi.spyOn(application, 'getPath').mockImplementation((key, filename) => {
      const base = key === 'user.memory' ? userPath : key === 'feature.agents.data' ? root : undefined
      return base ? (filename ? path.join(base, filename) : base) : original(key, filename)
    })
    restorePaths = () => spy.mockRestore()
    for (const id of ['first', 'second']) {
      const directory = await ensureAgentDataDirectory(root, id)
      dbh.db.insert(agentTable).values({ id, type: 'claude-code', name: id, instructions: '', orderKey: id }).run()
      dbh.db.insert(agentWorkspaceTable).values({ id, name: id, path: directory, orderKey: id }).run()
      dbh.db.insert(agentSessionTable).values({ id, agentId: id, workspaceId: id, name: id, orderKey: id }).run()
      clients.push(
        await connectMcpTestClient(() =>
          createAgentMemoryServer({ agentId: id, agentDataPath: directory, sessionId: id })
        )
      )
    }
    ;[first, second] = clients
  })

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()))
    restorePaths?.()
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('shares user facts while keeping omitted-scope facts private and preserving files on initialization', async () => {
    const initial = await read(first)
    expect(initial.content).toBe('')
    await call(first, { action: 'update', scope: 'user', content: 'Prefer pnpm', expectedRevision: initial.revision })
    await call(first, { action: 'update', content: 'Project requires npm' })
    expect((await read(second)).content).toBe('Prefer pnpm')
    expect(JSON.parse((await call(second, { action: 'read' })).content[0].text!).content).toBe('')
    await ensureUserMemory()
    expect((await read(first)).content).toBe('Prefer pnpm')
    const builder = new PromptBuilder()
    const a = await builder.buildMemoriesSection(path.join(root, 'first'), 'first')
    const b = await builder.buildMemoriesSection(path.join(root, 'second'), 'second')
    expect(a).toContain('## User-Level Facts')
    expect(a).toContain('## Agent Workspace Facts')
    expect(a).toContain('Project requires npm')
    expect(a).toContain('never silently overwrite')
    expect(b).toContain('Prefer pnpm')
    expect(b).not.toContain('Project requires npm')
    expect(await readFile(path.join(root, 'first', 'memory', 'FACT.md'), 'utf8')).toBe('Project requires npm')
    await rm(path.join(root, 'Memory'), { recursive: true })
    expect((await read(second)).content).toBe('')
    expect(await readFile(path.join(root, 'first', 'memory', 'FACT.md'), 'utf8')).toBe('Project requires npm')
  })

  it('rejects stale tool and settings updates and preserves complete concurrent journal records', async () => {
    const initial = await read(first)
    const results = await Promise.all(
      [first, second].map((client, index) =>
        call(client, { action: 'update', scope: 'user', content: `Fact ${index}`, expectedRevision: initial.revision })
      )
    )
    expect(results.filter((result) => result.isError)).toHaveLength(1)
    expect(results.find((result) => result.isError)?.content[0].text).toContain('MEMORY_CONFLICT')
    const current = await read(first)
    await expect(
      memoryHandlers['memory.user.facts.update'](
        { content: 'Stale settings', expectedRevision: initial.revision },
        { senderId: null }
      )
    ).rejects.toMatchObject({ code: 'MEMORY_CONFLICT' })
    expect(await read(first)).toEqual(current)
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        call(i % 2 ? first : second, { action: 'append', scope: 'user', text: `Event ${i}`, tags: ['test'] })
      )
    )
    const entries = JSON.parse((await call(first, { action: 'search', scope: 'user', tag: 'test' })).content[0].text!)
    expect(new Set(entries.map((entry: { text: string }) => entry.text)).size).toBe(12)
    expect(entries.every((entry: { ts: string }) => Number.isFinite(Date.parse(entry.ts)))).toBe(true)
    expect((await call(first, { action: 'update', scope: 'user', content: 'Missing revision' })).isError).toBe(true)
    expect(await read(first)).toEqual(current)
  })

  it('preserves renamed shared files and rejects a redirected user memory directory', async () => {
    const initial = await read(first)
    await call(first, {
      action: 'update',
      scope: 'user',
      content: 'Keep this fact',
      expectedRevision: initial.revision
    })
    const memory = path.join(root, 'Memory')
    await rename(path.join(memory, 'USER_FACT.md'), path.join(memory, 'user_fact.md'))
    await ensureUserMemory()
    expect((await read(first)).content).toBe('Keep this fact')
    const outside = path.join(root, 'outside')
    await mkdir(outside)
    await writeFile(path.join(outside, 'USER_FACT.md'), 'Not shared')
    await rm(memory, { recursive: true })
    await symlink(outside, memory, process.platform === 'win32' ? 'junction' : 'dir')
    expect((await call(first, { action: 'read', scope: 'user' })).isError).toBe(true)
    expect((await call(first, { action: 'append', scope: 'user', text: 'Do not write here' })).isError).toBe(true)
    expect(await readFile(path.join(outside, 'USER_FACT.md'), 'utf8')).toBe('Not shared')
  })

  it('checks the live opt-out and channel ownership on an already connected tool', async () => {
    const initial = await read(first)
    await call(first, {
      action: 'update',
      scope: 'user',
      content: 'Desktop secret',
      expectedRevision: initial.revision
    })
    dbh.db
      .update(agentTable)
      .set({ configuration: { userMemoryEnabled: false } })
      .where(eq(agentTable.id, 'first'))
      .run()
    expect((await call(first, { action: 'read', scope: 'user' })).isError).toBe(true)
    const builder = new PromptBuilder()
    expect(await builder.buildMemoriesSection(path.join(root, 'first'), 'first')).not.toContain('Desktop secret')
    expect((await call(first, { action: 'update', content: 'Local only' })).isError).not.toBe(true)
    dbh.db.update(agentTable).set({ configuration: {} }).where(eq(agentTable.id, 'first')).run()
    dbh.db
      .insert(agentChannelTable)
      .values({
        id: 'channel',
        type: 'telegram',
        name: 'channel',
        agentId: 'first',
        workspace: { type: 'system' },
        config: { bot_token: 'fixture' }
      })
      .run()
    dbh.db.insert(agentChannelSessionTable).values({ sessionId: 'first', channelId: 'channel' }).run()
    for (const action of ['read', 'search', 'append', 'update']) {
      const result = await call(first, {
        action,
        scope: 'user',
        text: 'Forbidden',
        content: 'Forbidden',
        expectedRevision: initial.revision
      })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).not.toContain('Desktop secret')
    }
    expect(await builder.buildMemoriesSection(path.join(root, 'first'), 'first')).not.toContain('## User-Level Facts')
    expect((await read(second)).content).toBe('Desktop secret')
  })

  it.each(['claude-code', 'pi'])(
    'refreshes edited and cleared shared facts on %s without reconnecting',
    async (runtime) => {
      const directory = path.join(root, 'first')
      const hooks = createClaudeCodeIdentityHooks(directory, 'first')
      let beforeStart!: (event: BeforeAgentStartEvent) => Promise<void>
      await createPiIdentityExtension(
        directory,
        'first'
      )({
        on: (name: string, handler: typeof beforeStart) => {
          if (name === 'before_agent_start') beforeStart = handler
        }
      } as ExtensionAPI)
      async function deliver() {
        if (runtime === 'pi') {
          const event = { systemPromptOptions: { sections: {} } } as BeforeAgentStartEvent
          await beforeStart(event)
          return event.systemPromptOptions.sections.agent_identity
        }
        const result = (await hooks.SessionStart![0].hooks[0](
          { hook_event_name: 'SessionStart', source: 'compact' } as HookInput,
          undefined,
          { signal: new AbortController().signal }
        )) as SyncHookJSONOutput
        return (result.hookSpecificOutput as { additionalContext: string }).additionalContext
      }
      const initial = await read(first)
      await call(first, { action: 'update', scope: 'user', content: 'Shared A', expectedRevision: initial.revision })
      expect(await deliver()).toContain('Shared A')
      dbh.db.update(agentSessionTable).set({ type: 'background' }).where(eq(agentSessionTable.id, 'first')).run()
      expect(await deliver()).toContain('Shared A')
      const current = await read(first)
      await memoryHandlers['memory.user.facts.update'](
        { content: '', expectedRevision: current.revision },
        { senderId: null }
      )
      expect(await deliver()).not.toContain('Shared A')
      expect(await deliver()).toContain('replaces all earlier snapshots')
      dbh.db
        .update(agentTable)
        .set({ configuration: { userMemoryEnabled: false } })
        .where(eq(agentTable.id, 'first'))
        .run()
      expect(await deliver()).not.toContain('## User-Level Facts')
    }
  )
})
