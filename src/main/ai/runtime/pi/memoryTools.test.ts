import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { ExtensionAPI, ExtensionToolContext } from '@earendil-works/pi-coding-agent'
import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { MemoryService } from '@main/ai/memory/MemoryService'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { BaseService } from '@main/core/lifecycle'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'

import type { AgentRuntimeToolApprovalRequest } from '../types'
import { createPiMemoryTools } from './memoryTools'
import { loadPiSdk } from './piSdk'

describe('Pi managed file destinations', () => {
  const dbh = setupTestDatabase()
  let root: string
  let memory: MemoryService
  let controlled: ReturnType<typeof createPiMemoryTools>
  let mode: AgentPermissionMode
  let requests: AgentRuntimeToolApprovalRequest[]

  async function removeFixture(directory: string): Promise<void> {
    if (directory !== root && !directory.startsWith(`${root}${path.sep}`)) throw new Error('Outside test fixture')
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory() && !entry.isSymbolicLink()) await removeFixture(target)
      else await unlink(target)
    }
    await rmdir(directory)
  }

  beforeEach(async () => {
    BaseService.resetInstances()
    mode = 'bypassPermissions'
    requests = []
    root = await mkdtemp(path.join(os.tmpdir(), 'cherry-pi-memory-'))
    vi.spyOn(application, 'getPath').mockImplementation((key, name) => path.join(root, key, name ?? ''))
    await mkdir(application.getPath('app.userdata'))
    await writeFile(application.getPath('app.database.file'), '')
    memory = new MemoryService()
    MockApplicationUtils.setService('MemoryService', memory)
    const agentId = randomUUID()
    const sessionId = randomUUID()
    const workspaceId = randomUUID()
    const workspacePath = path.join(root, 'workspace')
    await mkdir(workspacePath)
    dbh.db.insert(agentTable).values({ id: agentId, type: 'pi', name: 'A', instructions: '', orderKey: 'a0' }).run()
    dbh.db.insert(agentWorkspaceTable).values({ id: workspaceId, name: 'W', path: workspacePath, orderKey: 'a0' }).run()
    dbh.db.insert(agentSessionTable).values({ id: sessionId, agentId, workspaceId, name: 'S', orderKey: 'a0' }).run()
    const agentDataPath = application.getPath('feature.agents.data', agentId)
    await mkdir(agentDataPath, { recursive: true })
    controlled = createPiMemoryTools(await loadPiSdk(), {
      sessionId,
      workspacePath,
      agentDataPath,
      additionalReadOnlyRoots: [],
      emit: (event) => {
        if (event.type === 'tool-approval-request') requests.push(event.request)
      },
      getInteractionState: () => ({ currentTurn: 'interactive', userResponse: 'stream' }),
      getPermissionMode: () => mode,
      isDisabled: () => false,
      autoApprovedTools: new Set(),
      approvalRequiredTools: new Set(),
      nonBypassableApprovalTools: new Set(),
      delegationTools: new Set()
    })
    let start: (() => Promise<unknown>) | undefined
    await controlled.extension({
      on: (event: string, handler: () => Promise<unknown>) => {
        if (event === 'before_agent_start') start = handler
      }
    } as ExtensionAPI)
    await start!()
  })

  afterEach(async () => {
    controlled?.dispose()
    await memory?.['_doStop']()
    vi.restoreAllMocks()
    MockApplicationUtils.resetServices()
    if (root) await removeFixture(root)
  })

  async function execute(name: string, args: Record<string, unknown>) {
    const tool = controlled.tools.find((item) => item.name === name)!
    return tool.execute(randomUUID(), args, undefined, undefined, {} as ExtensionToolContext)
  }

  it.each([true, false])(
    'requires a decision on the complete computed memory proposal (approved=%s)',
    async (approved) => {
      const entry = application.getPath('feature.memory.data', 'MEMORY.md')
      await mkdir(path.dirname(entry), { recursive: true })
      const original = 'Short answers.\nKeep this exception.\n'
      await writeFile(entry, original)
      const result = await execute('read', { path: entry })
      const read = JSON.parse(result.content.find((part) => part.type === 'text')!.text) as {
        memoryReceipt: string
        hash: string
      }
      mode = 'default'
      const pending = execute('edit', {
        path: entry,
        edits: [{ oldText: 'Short', newText: 'Detailed' }],
        memoryReceipt: read.memoryReceipt
      }).catch((error: unknown) => error)
      await vi.waitFor(() => expect(requests).toHaveLength(1))
      expect(requests[0]).toMatchObject({
        presentation: 'stream',
        toolName: 'edit',
        input: {
          path: entry,
          memoryPreview: [
            { path: 'MEMORY.md', expectedHash: read.hash, content: 'Detailed answers.\nKeep this exception.\n' }
          ]
        }
      })
      expect(await readFile(entry, 'utf8')).toBe(original)
      toolApprovalRegistry.dispatch(requests[0].approvalId, { approved })
      const outcome = await pending
      if (!approved) expect(outcome).toBeInstanceOf(Error)
      else expect(outcome).not.toBeInstanceOf(Error)
      expect(await readFile(entry, 'utf8')).toBe(approved ? 'Detailed answers.\nKeep this exception.\n' : original)
    }
  )

  it('does not present a model-supplied memory preview for an ordinary file write', async () => {
    mode = 'default'
    const target = path.join(root, 'workspace', 'ordinary.txt')
    const pending = execute('write', {
      path: target,
      content: 'Actual ordinary content',
      memoryPreview: [{ path: 'MEMORY.md', expectedHash: null, content: 'Misleading preview' }]
    })
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0].input).toEqual({ path: target, content: 'Actual ordinary content' })
    toolApprovalRegistry.dispatch(requests[0].approvalId, { approved: true })
    await pending
    expect(await readFile(target, 'utf8')).toBe('Actual ordinary content')
  })

  it.for(['native', 'msys', 'wsl', 'cygwin'])(
    'enforces receipts and private authority for %s paths through the real SDK',
    async (variant, context) => {
      if (variant !== 'native' && process.platform !== 'win32') context.skip()
      const alias = (target: string) => {
        if (variant === 'native') return target
        const prefix = variant === 'wsl' ? '/mnt' : variant === 'cygwin' ? '/cygdrive' : ''
        return `${prefix}/${target[0].toLowerCase()}${target.slice(2).replaceAll('\\', '/')}`
      }
      const entry = application.getPath('feature.memory.data', 'MEMORY.md')
      await mkdir(path.dirname(entry), { recursive: true })
      await writeFile(entry, 'original')
      await expect(execute('write', { path: alias(entry), content: 'uncontrolled' })).rejects.toThrow('complete read')
      expect(await readFile(entry, 'utf8')).toBe('original')
      const result = await execute('read', { path: alias(entry) })
      const block = result.content.find((part) => part.type === 'text')!
      const read = JSON.parse(block.text) as { content: string; memoryReceipt: string }
      expect(read.content).toBe('original')
      expect(read.memoryReceipt).toBeTruthy()
      await execute('edit', {
        path: alias(entry),
        edits: [{ oldText: 'original', newText: 'controlled' }],
        memoryReceipt: read.memoryReceipt
      })
      expect(await readFile(entry, 'utf8')).toBe('controlled')
      const inspection = memory.open({ scope: { kind: 'shared' }, assertAuthorized: () => undefined })
      const recovery = await inspection.previewRecovery()
      expect(recovery?.files).toHaveLength(1)
      await inspection.recover(recovery!.token, async () => () => undefined)
      expect(await readFile(entry, 'utf8')).toBe('original')
      inspection.dispose()

      const foreign = application.getPath('feature.agents.data', `${randomUUID()}/MEMORY.md`)
      await mkdir(path.dirname(foreign), { recursive: true })
      await writeFile(foreign, 'foreign secret')
      await expect(execute('read', { path: alias(foreign) })).rejects.toThrow('Another Agent')

      const ordinary = path.join(root, 'workspace', 'ordinary.txt')
      await execute('write', { path: alias(ordinary), content: 'ordinary data' })
      expect(await readFile(ordinary, 'utf8')).toBe('ordinary data')
    }
  )
})
