import { randomUUID } from 'node:crypto'

import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { BaseService } from '@main/core/lifecycle/BaseService'
import type { UniqueModelId } from '@shared/data/types/model'

const controls = vi.hoisted(() => ({
  settled: vi.fn().mockResolvedValue(undefined),
  closeWarm: vi.fn().mockResolvedValue(undefined),
  startRuntimeTurn: vi.fn<(input: any) => void>()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const get = result.application.getContainer().get.bind(result.application.getContainer())
  result.application.get.mockImplementation((name: string) => {
    if (name === 'AiStreamManager')
      return {
        whenTerminalDispatchSettled: controls.settled,
        startRuntimeTurn: controls.startRuntimeTurn,
        broadcastTopicError: vi.fn()
      }
    if (name === 'ClaudeCodeWarmQueryManager') return { close: controls.closeWarm }
    return get(name)
  })
  return result
})

const { AgentSessionRuntimeService } = await import('../AgentSessionRuntimeService')
const { runtimeDriverRegistry } = await import('../../runtime/registry')
const modelId = 'provider::model' as UniqueModelId
const processError = {
  name: 'ClaudeCodeProcessExitError',
  message: 'Claude Code process exited with code 1',
  stack: null,
  claudeCodeExitCategory: 'unknown' as const,
  diagnosticReference: 'process-reference'
}

function deferred() {
  return Promise.withResolvers<void>()
}

describe('Claude foreground runtime recovery', () => {
  const dbh = setupTestDatabase()
  let service: InstanceType<typeof AgentSessionRuntimeService>

  function rows(sessionId = 'target') {
    return dbh.db
      .select()
      .from(agentSessionMessageTable)
      .all()
      .filter((row) => row.sessionId === sessionId)
  }

  function begin(options: { headless?: boolean; modelId?: UniqueModelId } = {}) {
    const id = randomUUID()
    const message = agentSessionMessageService.saveMessage({
      sessionId: 'target',
      message: {
        id: randomUUID(),
        role: 'user',
        status: 'success',
        data: { parts: [{ type: 'text', text: id }] }
      }
    })
    const handle = service.beginTurn({
      sessionId: 'target',
      topicId: 'agent-session:target',
      agentId: 'agent',
      agentType: 'claude-code',
      modelId: options.modelId ?? modelId,
      assistantMessageId: id,
      userMessage: message,
      headless: options.headless
    })
    const entry = (service as any).entries.get('target')
    entry.lastResumeToken = 'T'
    return { handle, entry, id }
  }

  async function terminal(
    turn: ReturnType<typeof begin>,
    status: 'error' | 'success' | 'paused' = 'error',
    error = processError
  ) {
    const result = {
      status,
      isTopicDone: true,
      error,
      finalMessage: {
        id: turn.id,
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, text: 'visible answer' }]
      }
    }
    const persistence = turn.handle.listeners[0]
    const listener = turn.handle.listeners[1]
    if (status === 'error') {
      await persistence.onError({ ...result, status: 'error' })
      await listener.onError({ ...result, status: 'error' })
    } else if (status === 'success') {
      await persistence.onDone({ ...result, status: 'success' })
      await listener.onDone({ ...result, status: 'success' })
    } else {
      await persistence.onPaused({ ...result, status: 'paused' })
      await listener.onPaused({ ...result, status: 'paused' })
    }
  }

  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    controls.settled.mockResolvedValue(undefined)
    controls.closeWarm.mockResolvedValue(undefined)
    service = new AgentSessionRuntimeService()
    dbh.db.insert(userProviderTable).values({ providerId: 'provider', name: 'Provider', orderKey: 'a' }).run()
    for (const name of ['model', 'other'])
      dbh.db
        .insert(userModelTable)
        .values({
          id: `provider::${name}`,
          providerId: 'provider',
          modelId: name,
          name,
          capabilities: [],
          supportsStreaming: true,
          orderKey: name
        })
        .run()
    dbh.db
      .insert(agentTable)
      .values({ id: 'agent', type: 'claude-code', name: 'Agent', instructions: '', model: modelId, orderKey: 'a' })
      .run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', name: 'Workspace', path: '/tmp/workspace', type: 'user', orderKey: 'a' })
      .run()
    for (const id of ['target', 'control']) {
      dbh.db.insert(agentSessionTable).values({ id, name: id, workspaceId: 'workspace', orderKey: id }).run()
      for (let index = 0; index < 4; index++)
        dbh.db
          .insert(agentSessionMessageTable)
          .values({
            id: `${id}-history-${index}`,
            sessionId: id,
            role: 'assistant',
            status: 'success',
            runtimeResumeToken: 'T',
            data: {
              parts: [{ type: 'text', text: `history-${index}` }],
              nativeSessionId: 'old-native',
              extra: 'keep'
            } as any
          })
          .run()
    }
  })

  it('clears every historical selector only after third terminal persistence and dispatch, preserving conversation and sibling', async () => {
    const history = rows()
    const sibling = rows('control')
    await terminal(begin())
    await terminal(begin())
    expect(agentSessionMessageService.getLastRuntimeResumeToken('target')).toBe('T')
    const barrier = deferred()
    controls.settled.mockReturnValue(barrier.promise)
    const third = begin()
    await terminal(third)
    expect(service.hasRequiredRuntimeReset('target')).toBe(true)
    const reset = service.ensureRuntimeResetComplete('target')
    expect(service.resetRuntime('target')).toBe(reset)
    expect(agentSessionMessageService.getLastRuntimeResumeToken('target')).toBe('T')
    // Duplicate terminal delivery cannot increment the turn again.
    await third.handle.listeners[1].onError({ status: 'error', error: processError })
    barrier.resolve()
    await reset
    expect(controls.closeWarm).toHaveBeenCalledTimes(1)
    expect(rows().every((row) => row.runtimeResumeToken === null && !('nativeSessionId' in row.data))).toBe(true)
    expect(agentSessionMessageService.getLastRuntimeResumeToken('target')).toBeNull()
    expect(agentSessionMessageService.getNativeSessionId('target')).toBeUndefined()
    for (const original of history) {
      expect(rows().find((row) => row.id === original.id)).toEqual({
        ...original,
        runtimeResumeToken: null,
        data: { ...original.data, nativeSessionId: undefined }
      })
    }
    expect(rows('control')).toEqual(sibling)
    BaseService.resetInstances()
    service = new AgentSessionRuntimeService()
    expect(agentSessionMessageService.getLastRuntimeResumeToken('target')).toBeNull()
    expect(agentSessionMessageService.getNativeSessionId('target')).toBeUndefined()
  })

  it.each(['process-error', 'api-error'] as const)('ignores duplicate terminal callbacks after %s', async (kind) => {
    if (kind === 'api-error') await terminal(begin())
    const turn = begin()
    const error = kind === 'process-error' ? processError : { ...processError, name: 'APIError' }
    await terminal(turn, 'error', error)
    const listener = turn.handle.listeners[1]
    await listener.onError({ status: 'error', error })
    await listener.onDone({ status: 'success' })
    expect((service as any).failureStreaks.get('target')?.count).toBe(kind === 'process-error' ? 1 : undefined)
    expect(service.hasRequiredRuntimeReset('target')).toBe(false)

    await terminal(begin())
    await listener.onError({ status: 'error', error })
    await listener.onDone({ status: 'success' })
    expect((service as any).failureStreaks.get('target')?.count).toBe(kind === 'process-error' ? 2 : 1)
    expect(service.hasRequiredRuntimeReset('target')).toBe(false)
    expect(agentSessionMessageService.getLastRuntimeResumeToken('target')).toBe('T')
  })

  it('bounds terminal receipts while retaining duplicate protection for recent turns', async () => {
    const cap = 256
    for (let index = 0; index < cap + 16; index++) {
      await terminal(begin(), 'success')
      expect((service as any).terminalReceipts.size).toBeLessThanOrEqual(cap)
    }
    const turn = begin()
    await terminal(turn)
    await turn.handle.listeners[1].onError({ status: 'error', error: processError })
    await turn.handle.listeners[1].onDone({ status: 'success' })
    expect((service as any).terminalReceipts.size).toBe(cap)
    expect((service as any).failureStreaks.get('target').count).toBe(1)
    expect(service.hasRequiredRuntimeReset('target')).toBe(false)
  })

  it.each(['success', 'paused', 'api-error'] as const)('%s breaks a foreground failure streak', async (boundary) => {
    await terminal(begin())
    await terminal(begin())
    await terminal(
      begin(),
      boundary === 'api-error' ? 'error' : boundary,
      boundary === 'api-error' ? { ...processError, name: 'APIError' } : processError
    )
    await terminal(begin())
    expect(service.hasRequiredRuntimeReset('target')).toBe(false)
    expect((service as any).failureStreaks.get('target').count).toBe(1)
    expect(agentSessionMessageService.getLastRuntimeResumeToken('target')).toBe('T')
  })

  it('background outcomes neither increment nor clear; effective model changes start a new streak', async () => {
    await terminal(begin())
    await terminal(begin({ headless: true }))
    await terminal(begin({ headless: true }), 'success')
    await terminal(begin())
    expect((service as any).failureStreaks.get('target').count).toBe(2)
    await terminal(begin({ modelId: 'provider::other' }))
    expect((service as any).failureStreaks.get('target').count).toBe(1)
    expect(controls.closeWarm).not.toHaveBeenCalled()
  })

  it('retains durable identity on refused reset and retries at admission', async () => {
    const active = begin()
    await expect(service.resetRuntime('target')).rejects.toMatchObject({ reason: 'busy' })
    expect(agentSessionMessageService.getLastRuntimeResumeToken('target')).toBe('T')
    expect(service.hasRequiredRuntimeReset('target')).toBe(true)
    expect(() => service.assertSessionWritable('target')).toThrow()
    await terminal(active)
    await service.ensureRuntimeResetComplete('target')
    expect(agentSessionMessageService.getLastRuntimeResumeToken('target')).toBeNull()
  })

  it('strict warm closure failure keeps the requirement and selectors; a later admission retries', async () => {
    controls.closeWarm.mockRejectedValueOnce(new Error('close failed'))
    await expect(service.resetRuntime('target')).rejects.toThrow('close failed')
    expect(service.hasRequiredRuntimeReset('target')).toBe(true)
    expect(agentSessionMessageService.getLastRuntimeResumeToken('target')).toBe('T')
    await service.ensureRuntimeResetComplete('target')
    expect(agentSessionMessageService.getLastRuntimeResumeToken('target')).toBeNull()
  })

  it('reconnect never hands off a closing pre-reset token, and later hydrates only T2', async () => {
    const close = deferred()
    ;(service as any).closingSessions.set('target', { promise: close.promise, resumeToken: 'T' })
    const reset = service.resetRuntime('target')
    await Promise.resolve()
    ;(service as any).closingSessions.delete('target')
    close.resolve()
    await reset
    const connect = vi.fn<(input: unknown) => Promise<never>>(async () => {
      throw new Error('stop at connect input')
    })
    runtimeDriverRegistry.register({ type: 'claude-code', capabilities: ['agent-session'], connect } as any)
    const turn = begin()
    delete turn.entry.lastResumeToken
    await expect((service as any).ensureConnection(turn.entry)).rejects.toThrow('stop at connect input')
    expect(connect.mock.calls[0][0]).toMatchObject({ resumeToken: undefined, nativeSessionId: undefined })
    agentSessionMessageService.saveMessage({
      sessionId: 'target',
      runtimeResumeToken: 'T2',
      message: {
        id: randomUUID(),
        role: 'assistant',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'fresh context' }] }
      }
    })
    delete turn.entry.lastResumeToken
    await expect((service as any).ensureConnection(turn.entry)).rejects.toThrow('stop at connect input')
    expect(connect.mock.calls[1][0]).toMatchObject({ resumeToken: 'T2' })
  })

  it('does not reset before a delayed terminal persistence receipt, including when the entry was disposed', async () => {
    await terminal(begin())
    await terminal(begin())
    const third = begin()
    await service.closeSession('target')
    expect(service.hasRequiredRuntimeReset('target')).toBe(false)
    expect(agentSessionMessageService.getLastRuntimeResumeToken('target')).toBe('T')
    await terminal(third)
    await service.ensureRuntimeResetComplete('target')
    expect(rows().find((row) => row.id === third.id)?.runtimeResumeToken).toBeNull()
    expect(agentSessionMessageService.getLastRuntimeResumeToken('target')).toBeNull()
  })

  it('keeps failed-closure token claims and rejects admission until strict closure succeeds', async () => {
    const turn = begin()
    await terminal(turn, 'success')
    const close = vi.fn().mockRejectedValue(new Error('native writer remains'))
    turn.entry.runtimeState.connection = { kind: 'connected', connection: { close }, occupancy: {} }
    await expect(service.resetRuntime('target')).rejects.toMatchObject({ reason: 'close_failed' })
    expect(service.listClaimedResumeTokens().has('T')).toBe(true)
    expect(agentSessionMessageService.getLastRuntimeResumeToken('target')).toBe('T')
    expect(() => service.assertSessionWritable('target')).toThrow()
    close.mockResolvedValue(undefined)
    await service.ensureRuntimeResetComplete('target')
    expect(agentSessionMessageService.getLastRuntimeResumeToken('target')).toBeNull()
    expect(service.listClaimedResumeTokens().has('T')).toBe(false)
  })

  it('retains required reset on storage failure and tracks the operation in write-quiesce drain', async () => {
    const barrier = deferred()
    controls.settled.mockReturnValueOnce(barrier.promise)
    const clear = vi.spyOn(agentSessionMessageService, 'clearRuntimeIdentity').mockImplementationOnce(() => {
      throw new Error('storage unavailable')
    })
    const reset = service.resetRuntime('target')
    const observed = reset.catch((error) => error)
    expect(service.hasBusySessions()).toBe(true)
    const pause = service.pause('test-drain')
    const drain = service.drainInFlight({ timeoutMs: 1000 })
    barrier.resolve()
    await observed
    expect(await drain).toEqual({ stragglerIds: [] })
    expect(service.hasRequiredRuntimeReset('target')).toBe(true)
    expect(agentSessionMessageService.getLastRuntimeResumeToken('target')).toBe('T')
    pause.dispose()
    await expect(service.ensureRuntimeResetComplete('target')).rejects.toThrow('storage unavailable')
    clear.mockRestore()
    await service.ensureRuntimeResetComplete('target')
    expect(agentSessionMessageService.getLastRuntimeResumeToken('target')).toBeNull()
  })

  it('counts startup failures from openTurnStream exactly once after persistence', async () => {
    const connect = vi.fn(async () => {
      throw Object.assign(new Error(processError.message), processError)
    })
    runtimeDriverRegistry.register({ type: 'claude-code', capabilities: ['agent-session'], connect } as any)
    for (let index = 0; index < 3; index++) {
      const turn = begin()
      const reader = service
        .openTurnStream({ sessionId: 'target', turnId: turn.handle.turnId, signal: turn.handle.abortController.signal })
        .getReader()
      let failure: unknown
      try {
        while (!(await reader.read()).done) {
          /* drain start chunks */
        }
      } catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({ name: 'ClaudeCodeProcessExitError', diagnosticReference: 'process-reference' })
      await terminal(turn)
    }
    await service.ensureRuntimeResetComplete('target')
    expect(agentSessionMessageService.getLastRuntimeResumeToken('target')).toBeNull()
  })

  it('joins a pre-existing fork while excluding new mutation owners', async () => {
    const fork = Promise.withResolvers<string>()
    const operations = (service as any).forks
    operations.pending.set('fork-key', { sourceSessionId: 'target', promise: fork.promise })
    const reset = service.resetRuntime('target')
    await Promise.resolve()
    expect(agentSessionMessageService.getLastRuntimeResumeToken('target')).toBe('T')
    expect(() => service.forkSession('target', 'message')).toThrow()
    operations.pending.delete('fork-key')
    fork.resolve('child')
    await reset
    expect(agentSessionMessageService.getLastRuntimeResumeToken('target')).toBeNull()
  })

  it('drains an in-flight connection generation before clearing its token', async () => {
    const turn = begin()
    await terminal(turn, 'success')
    const opened = Promise.withResolvers<any>()
    runtimeDriverRegistry.register({
      type: 'claude-code',
      capabilities: ['agent-session'],
      connect: () => opened.promise
    } as any)
    const connecting = (service as any).ensureConnection(turn.entry)
    const reset = service.resetRuntime('target')
    await vi.waitFor(() => expect((service as any).entries.has('target')).toBe(false))
    expect(agentSessionMessageService.getLastRuntimeResumeToken('target')).toBe('T')
    const close = vi.fn().mockResolvedValue(undefined)
    opened.resolve({ close })
    await connecting
    await reset
    expect(close).toHaveBeenCalledOnce()
    expect(service.listClaimedResumeTokens().has('T')).toBe(false)
    expect(agentSessionMessageService.getLastRuntimeResumeToken('target')).toBeNull()
  })

  it('does not clear a foreground streak when a row-roll receipt arrives after entry disposal', async () => {
    await terminal(begin())
    await terminal(begin())
    const source = begin()
    const turn = source.entry.runtimeState.execution.turn
    ;(service as any).applyRuntimeStateEvent(source.entry, { type: 'turn-stream-opened', turn })
    ;(service as any).applyRuntimeStateEvent(source.entry, { type: 'steer-boundary', inputs: [], headless: false })
    await service.closeSession('target')
    await terminal(source, 'success')
    expect((service as any).failureStreaks.get('target').count).toBe(2)
    await terminal(begin())
    await service.ensureRuntimeResetComplete('target')
    expect(agentSessionMessageService.getLastRuntimeResumeToken('target')).toBeNull()
  })

  it('freezes queued messages through teardown and launches them once against a fresh entry', async () => {
    await terminal(begin())
    await terminal(begin())
    const third = begin()
    service.enqueueUserMessage('target', {
      id: 'queued-user',
      data: { parts: [{ type: 'text', text: 'next' }] }
    } as any)
    await terminal(third)
    await service.ensureRuntimeResetComplete('target')
    await new Promise((resolve) => setTimeout(resolve, 0))
    const fresh = (service as any).entries.get('target')
    expect(fresh).not.toBe(third.entry)
    expect(fresh.lastResumeToken).toBeUndefined()
    expect(fresh.runtimeState.queue).toEqual([])
    expect(controls.startRuntimeTurn).toHaveBeenCalledTimes(1)
    expect(controls.startRuntimeTurn.mock.calls[0][0].request.messages[0].id).toBe('queued-user')
  })
})
