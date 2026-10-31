import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { HookInput, SyncHookJSONOutput } from '@anthropic-ai/claude-agent-sdk'
import type { BeforeAgentStartEvent, ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PromptBuilder } from '@main/ai/agents/prompt'

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
