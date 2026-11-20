import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { createTestTerminalService } from '@test-helpers/terminal'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentSessionHandlers } from '@data/api/handlers/agentSessions'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { AgentLifecycleService } from '@main/ai/agents/AgentLifecycleService'
import { AgentSessionRuntimeService } from '@main/ai/agentSession/AgentSessionRuntimeService'
import { terminalConversationId } from '@main/services/terminal/contracts'
import type { IpcContext } from '@shared/ipc/types'
import { GHOSTTY_KEY_CODES } from '@shared/types/terminal'

import { terminalHandlers } from '../terminal'

describe.skipIf(process.platform === 'win32')('terminal IPC with native scopes and SQLite', () => {
  const dbh = setupTestDatabase()
  let root: string
  let service: Awaited<ReturnType<typeof createTestTerminalService>>
  let session: ReturnType<typeof agentSessionService.create>
  const owner: IpcContext = { senderId: 'window-one' }
  beforeEach(async () => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'cherry-terminal-ipc-')))
    vi.mocked(application.getPath).mockImplementation((key, file) => {
      const dir = path.join(root, key)
      mkdirSync(dir, { recursive: true })
      return file ? path.join(dir, file) : dir
    })
    service = await createTestTerminalService()
    MockApplicationUtils.setService('AiStreamManager', { isWriteQuiesced: false })
    MockApplicationUtils.setService('ClaudeCodeWarmQueryManager', { close: async () => {} })
    MockApplicationUtils.setService('AgentSessionRuntimeService', new AgentSessionRuntimeService())
    MockApplicationUtils.setService('AgentLifecycleService', new AgentLifecycleService())
    const window = Object.assign(new EventEmitter(), { isDestroyed: () => false })
    MockApplicationUtils.setService('WindowManager', { getWindow: () => window })
    dbh.db
      .insert(agentTable)
      .values({ id: 'terminal-agent', name: 'Terminal', type: 'pi', instructions: '', orderKey: 'a0' })
      .run()
    session = agentSessionService.create({ agentId: 'terminal-agent', name: 'Terminal', workspace: { type: 'system' } })
  })
  afterEach(async () => {
    await service._doStop()
    await application.get('AgentWorkspaceStorageService')._doStop()
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })
  async function open() {
    const receipt = await terminalHandlers['terminal.create'](
      { sessionId: session.id, shell: 'bash', operationId: crypto.randomUUID() },
      owner
    )
    if (receipt.kind !== 'resource') throw new Error('Terminal failed to open')
    return receipt.resource
  }
  it('keeps old cleanup discoverable and refuses to stop a replacement generation', async () => {
    const terminal = await open()
    const storage = application.get('AgentWorkspaceStorageService')
    const id = await storage.acquireUsage({
      sessionId: session.id,
      cwd: session.workspace.path,
      owner: {
        kind: 'terminal',
        resourceId: terminal.id,
        generation: crypto.randomUUID()
      }
    })
    storage.markUsageUnconfirmed(id)
    expect(await terminalHandlers['terminal.cleanup.status']({}, owner)).toMatchObject({ count: 1 })
    expect(await terminalHandlers['terminal.cleanup.list']({}, owner)).toMatchObject([{ id }])
    await expect(terminalHandlers['terminal.cleanup.retry']({ id }, owner)).resolves.toEqual({ status: 'unavailable' })
    expect(
      service.list(terminalConversationId.parse(session.id)).find((item) => item.id === terminal.id)
    ).toMatchObject({
      host: terminal.host,
      process: { kind: 'running' },
      control: { kind: 'user' }
    })
    expect(await terminalHandlers['terminal.cleanup.status']({}, owner)).toMatchObject({ count: 1 })
  })
  it('switches workspace while preserving the old terminal and protecting both resource scopes', async () => {
    expect(existsSync(session.workspace.path)).toBe(false)
    const terminal = await open()
    expect(existsSync(session.workspace.path)).toBe(true)
    expect(terminal.process.kind).toBe('running')
    const otherPath = path.join(root, 'other')
    mkdirSync(otherPath)
    const other = agentWorkspaceService.findOrCreateByPath(otherPath)
    const change = () =>
      agentSessionHandlers['/agent-sessions/:sessionId/workspace'].PUT({
        params: { sessionId: session.id },
        body: { type: 'user', workspaceId: other.id }
      })
    await vi.waitFor(() =>
      expect(service.list(terminalConversationId.parse(session.id))[0]?.shellFacts?.kind).toBe('prompt')
    )
    await change()
    expect(agentSessionService.getById(session.id).workspaceId).toBe(other.id)
    const retained = service.list(terminalConversationId.parse(session.id))[0]
    expect(retained).toMatchObject({
      id: terminal.id,
      host: terminal.host,
      process: { kind: 'running' },
      control: { kind: 'user' },
      shellFacts: { kind: 'prompt', cwd: session.workspace.path }
    })
    const second = await open()
    expect(second.host).toEqual(terminal.host)
    await vi.waitFor(() =>
      expect(
        service.list(terminalConversationId.parse(session.id)).find((item) => item.id === second.id)?.shellFacts
      ).toMatchObject({ kind: 'prompt', cwd: other.path })
    )
    const storage = application.get('AgentWorkspaceStorageService')
    expect(
      await storage.reclaimOrphanWorkspace(session.workspace.path, { now: Date.now() + 600_000, freshnessGateMs: 0 })
    ).toEqual([])
    expect(existsSync(session.workspace.path)).toBe(true)
    await terminalHandlers['terminal.stop'](
      {
        ref: { host: terminal.host, id: terminal.id },
        operationId: crypto.randomUUID(),
        controlRevision: terminal.controlRevision,
        cancelRevision: terminal.cancelRevision
      },
      owner
    )
    expect(
      service.list(terminalConversationId.parse(session.id)).find((item) => item.id === second.id)?.process.kind
    ).toBe('running')
    await terminalHandlers['terminal.stop'](
      {
        ref: { host: second.host, id: second.id },
        operationId: crypto.randomUUID(),
        controlRevision: second.controlRevision,
        cancelRevision: second.cancelRevision
      },
      owner
    )
    await vi.waitFor(() => expect(service.hasActiveResources(session.id)).toBe(false))
    await vi.waitFor(async () =>
      expect(
        await storage.reclaimOrphanWorkspace(session.workspace.path, { now: Date.now() + 600_000, freshnessGateMs: 0 })
      ).toContain(session.workspace.path)
    )
    expect(existsSync(other.path)).toBe(true)
  })
  it('grants input and resize to the controlling view only, and keeps the process after both views detach', async () => {
    const terminal = await open()
    const ref = { host: terminal.host, id: terminal.id }
    const second: IpcContext = { senderId: 'window-two' }
    const firstView = await terminalHandlers['terminal.attach'](ref, owner)
    const secondView = await terminalHandlers['terminal.attach'](ref, second)
    const take = await terminalHandlers['terminal.action'](
      {
        viewId: firstView,
        operationId: crypto.randomUUID(),
        controlRevision: terminal.controlRevision,
        action: { kind: 'take-control' }
      },
      owner
    )
    if (take.kind !== 'resource') throw new Error('Control transfer failed')
    const rejected = await terminalHandlers['terminal.action'](
      {
        viewId: secondView,
        operationId: crypto.randomUUID(),
        controlRevision: take.resource.controlRevision,
        action: { kind: 'paste', geometryEpoch: 0, data: 'WRONG-VIEW-BYTES' }
      },
      second
    )
    expect(rejected).toEqual({ kind: 'rejected', reason: 'stale_control' })
    await terminalHandlers['terminal.action'](
      {
        viewId: firstView,
        operationId: crypto.randomUUID(),
        controlRevision: take.resource.controlRevision,
        action: { kind: 'paste', geometryEpoch: 0, data: 'printf CONTROLLED' }
      },
      owner
    )
    await terminalHandlers['terminal.action'](
      {
        viewId: firstView,
        operationId: crypto.randomUUID(),
        controlRevision: take.resource.controlRevision,
        action: {
          kind: 'key',
          geometryEpoch: 0,
          event: {
            key: GHOSTTY_KEY_CODES.indexOf('Enter'),
            mods: 0,
            consumedMods: 0,
            composing: false,
            unshiftedCodepoint: 0,
            text: '',
            repeat: false
          }
        }
      },
      owner
    )
    await vi.waitFor(() => expect(service.readText(ref).output).toContain('\r\nCONTROLLED'))
    expect(service.readText(ref).output).not.toContain('WRONG-VIEW-BYTES')
    await terminalHandlers['terminal.detach']({ viewId: firstView }, owner)
    await terminalHandlers['terminal.detach']({ viewId: secondView }, second)
    expect(service.list(terminalConversationId.parse(session.id))[0]?.process.kind).toBe('running')
  })
  it('seals an admitted workspace preparation before it can launch after conversation close', async () => {
    const pending = service.createUserTerminal(
      session.id,
      session.workspace.path,
      'bash',
      'pending',
      service.workspaceRevision(session.id),
      async () => {}
    )
    expect(service.hasActiveResources(session.id)).toBe(true)
    await service.closeConversation(terminalConversationId.parse(session.id))
    await expect(pending).resolves.toEqual({ kind: 'rejected', reason: 'closing' })
    expect(service.list(terminalConversationId.parse(session.id))).toEqual([])
    expect(service.hasActiveResources(session.id)).toBe(false)
  })
  it('keeps cursor reads on UTF-8 boundaries across small chunks', async () => {
    const lease = await service.attachRuntime({ conversationId: session.id, contextId: 'reader', bindingId: 'binding' })
    const started = await service.start({
      lease,
      replayKey: 'utf8',
      turnId: 'turn',
      launch: {
        kind: 'pipe',
        shell: 'bash',
        file: '/bin/bash',
        args: ['-c', "printf '中文🙂END'"],
        cwd: root,
        env: { PATH: '/usr/bin:/bin' },
        stdin: ''
      }
    })
    if (started.kind !== 'resource') throw new Error('Command failed to start')
    const ref = { host: started.resource.host, id: started.resource.id }
    await service.wait(ref, {})
    let cursor = 0
    let output = ''
    for (let i = 0; i < 10; i++) {
      const read = service.readText(ref, cursor, 4)
      output += read.output
      cursor = read.next
      if (read.next === read.end) break
    }
    expect(output).toBe('中文🙂END')
    expect(cursor).toBe(Buffer.byteLength(output))
  })
})
