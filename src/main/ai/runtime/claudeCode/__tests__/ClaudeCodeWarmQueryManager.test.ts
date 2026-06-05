import { BaseService } from '@main/core/lifecycle/BaseService'
import { IpcChannel } from '@shared/IpcChannel'
import { ipcMain } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { startupMock, buildWarmRequestMock, applicationGetMock, traceModeEnabledMock } = vi.hoisted(() => ({
  startupMock: vi.fn(),
  buildWarmRequestMock: vi.fn(),
  applicationGetMock: vi.fn(),
  traceModeEnabledMock: vi.fn()
}))

vi.mock('@main/core/application', () => ({
  application: { get: applicationGetMock }
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  startup: startupMock
}))

vi.mock('../agentSessionWarmup', () => ({
  buildClaudeCodeWarmQueryRequestForAgentSession: buildWarmRequestMock
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
  }
}))

const { ClaudeCodeWarmQueryManager, createClaudeCodeWarmQuerySignature } = await import('../ClaudeCodeWarmQueryManager')

function warmQuery() {
  return {
    query: vi.fn(),
    close: vi.fn()
  }
}

describe('ClaudeCodeWarmQueryManager', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    vi.useFakeTimers()
    applicationGetMock.mockImplementation((name: string) => {
      if (name === 'ClaudeCodeTraceBridgeService') return { isTraceModeEnabled: traceModeEnabledMock }
      throw new Error(`Unexpected application.get(${name})`)
    })
    traceModeEnabledMock.mockReturnValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('consumes a matching warm query once', async () => {
    const manager = new ClaudeCodeWarmQueryManager()
    const warm = warmQuery()
    const abortController = new AbortController()
    startupMock.mockResolvedValueOnce(warm)

    manager.prewarm({ key: 'session-1', options: { model: 'sonnet', resume: 'sdk-1', abortController } as any })

    const consumed = await manager.consume({ key: 'session-1', options: { model: 'sonnet', resume: 'sdk-1' } as any })
    const second = await manager.consume({ key: 'session-1', options: { model: 'sonnet', resume: 'sdk-1' } as any })

    expect(consumed).toBe(warm)
    expect(second).toBeUndefined()
    expect(startupMock).toHaveBeenCalledWith({
      options: { model: 'sonnet', resume: 'sdk-1' },
      initializeTimeoutMs: undefined
    })
    expect(warm.close).not.toHaveBeenCalled()
  })

  it('closes a stale warm query when session options change', async () => {
    const manager = new ClaudeCodeWarmQueryManager()
    const stale = warmQuery()
    const current = warmQuery()
    startupMock.mockResolvedValueOnce(stale).mockResolvedValueOnce(current)

    manager.prewarm({ key: 'session-1', options: { model: 'sonnet', resume: 'sdk-1' } as any })
    manager.prewarm({ key: 'session-1', options: { model: 'opus', resume: 'sdk-1' } as any })

    await Promise.resolve()
    const consumed = await manager.consume({ key: 'session-1', options: { model: 'opus', resume: 'sdk-1' } as any })

    expect(stale.close).toHaveBeenCalledOnce()
    expect(consumed).toBe(current)
  })

  it('uses the same signature with or without abortController', () => {
    const withAbort = createClaudeCodeWarmQuerySignature({
      model: 'sonnet',
      resume: 'sdk-1',
      abortController: new AbortController()
    } as any)
    const withoutAbort = createClaudeCodeWarmQuerySignature({ model: 'sonnet', resume: 'sdk-1' } as any)

    expect(withAbort).toBe(withoutAbort)
  })

  it('closes unused warm queries after the idle ttl', async () => {
    const manager = new ClaudeCodeWarmQueryManager()
    const warm = warmQuery()
    startupMock.mockResolvedValueOnce(warm)

    manager.prewarm({ key: 'session-1', options: { model: 'sonnet' } as any })
    await Promise.resolve()
    vi.advanceTimersByTime(5 * 60 * 1000)
    await Promise.resolve()

    expect(warm.close).toHaveBeenCalledOnce()
  })

  it('prewarms an agent session from the session request builder', async () => {
    const manager = new ClaudeCodeWarmQueryManager()
    const warm = warmQuery()
    buildWarmRequestMock.mockResolvedValueOnce({
      key: 'session-1',
      options: { model: 'sonnet', resume: 'sdk-1' },
      initializeTimeoutMs: 100
    })
    startupMock.mockResolvedValueOnce(warm)

    await manager.prewarmAgentSession('session-1')
    const consumed = await manager.consume({ key: 'session-1', options: { model: 'sonnet', resume: 'sdk-1' } as any })

    expect(buildWarmRequestMock).toHaveBeenCalledWith('session-1')
    expect(consumed).toBe(warm)
  })

  it('does not prewarm agent sessions while Claude Code trace mode is enabled', async () => {
    traceModeEnabledMock.mockReturnValue(true)
    const manager = new ClaudeCodeWarmQueryManager()

    await manager.prewarmAgentSession('session-1')

    expect(buildWarmRequestMock).not.toHaveBeenCalled()
    expect(startupMock).not.toHaveBeenCalled()
  })

  function getIpcHandler(channel: string): (...args: any[]) => unknown {
    const manager = new ClaudeCodeWarmQueryManager()
    ;(manager as any).onInit()
    const call = vi.mocked(ipcMain.handle).mock.calls.find(([registered]) => registered === channel)
    if (!call) throw new Error(`No IPC handler registered for ${channel}`)
    return call[1] as (...args: any[]) => unknown
  }

  it('ignores prewarm IPC requests with a missing or non-string sessionId', async () => {
    const handler = getIpcHandler(IpcChannel.Ai_AgentSession_Prewarm)

    await handler({}, { sessionId: '' })
    await handler({}, { sessionId: 123 as any })
    await handler({}, {})

    expect(buildWarmRequestMock).not.toHaveBeenCalled()
  })

  it('ignores close-warm IPC requests with a missing or non-string sessionId', async () => {
    const handler = getIpcHandler(IpcChannel.Ai_AgentSession_CloseWarm)
    const closeSpy = vi.spyOn(ClaudeCodeWarmQueryManager.prototype, 'closeAgentSessionWarm')

    handler({}, { sessionId: '' })
    handler({}, { sessionId: null as any })
    handler({}, {})

    expect(closeSpy).not.toHaveBeenCalled()
  })

  it('drops the live MCP server instance when building the warm-query signature', () => {
    const fakeInstance = { connect: vi.fn() }
    // Reference itself so the live instance is circular, matching real SDK objects.
    ;(fakeInstance as any).self = fakeInstance

    const withInstance = createClaudeCodeWarmQuerySignature({
      model: 'sonnet',
      mcpServers: { claw: { type: 'sdk', name: 'claw', instance: fakeInstance } }
    } as any)
    const withoutInstance = createClaudeCodeWarmQuerySignature({
      model: 'sonnet',
      mcpServers: { claw: { type: 'sdk', name: 'claw' } }
    } as any)

    expect(withInstance).toBe(withoutInstance)
    expect(withInstance).not.toContain('circular')
  })

  it('still distinguishes signatures by MCP server name and type', () => {
    const withInstance = (name: string) =>
      createClaudeCodeWarmQuerySignature({
        model: 'sonnet',
        mcpServers: { srv: { type: 'sdk', name, instance: { connect: vi.fn() } } }
      } as any)

    expect(withInstance('claw')).not.toBe(withInstance('assistant'))
  })
})
