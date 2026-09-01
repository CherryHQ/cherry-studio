import type * as NodeChildProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'
import type * as ProcessRunner from '@main/utils/processRunner'
import type { Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import type * as DeepSeekHarnessConfigModule from '../config'

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  isWin: false,
  appGet: vi.fn(),
  appGetPath: vi.fn(),
  spawn: vi.fn(),
  writeConfig: vi.fn(),
  rollbackConfig: vi.fn(),
  providerGet: vi.fn(),
  providerGetApiKeys: vi.fn(),
  modelGet: vi.fn(),
  gatewayStart: vi.fn(),
  gatewayEnsureKey: vi.fn(),
  gatewayGetConfig: vi.fn(),
  broadcast: vi.fn()
}))

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeChildProcess>()),
  execFile: mocks.execFile
}))
vi.mock('@application', () => ({ application: { get: mocks.appGet, getPath: mocks.appGetPath } }))
vi.mock('@data/services/ProviderService', () => ({
  providerService: { getByProviderId: mocks.providerGet, getApiKeys: mocks.providerGetApiKeys }
}))
vi.mock('@data/services/ModelService', () => ({ modelService: { getByKey: mocks.modelGet } }))
vi.mock('@main/core/platform', () => ({
  get isWin() {
    return mocks.isWin
  }
}))
vi.mock('@main/utils/processRunner', async (importOriginal) => ({
  ...(await importOriginal<typeof ProcessRunner>()),
  crossPlatformSpawn: mocks.spawn
}))
vi.mock('@main/utils/shellEnv', () => ({
  getRawShellEnv: vi.fn(async () => ({
    PATH: '/system/bin',
    CHERRY_STUDIO_CODEMATE_481BD06FDD6C_API_KEY: 'stale-inherited-key',
    CHERRY_STUDIO_CODEMATE_GATEWAY_API_KEY: 'stale-gateway-key',
    CHERRY_STUDIO_CODEMATE_USER_API_KEY: 'unrelated'
  })),
  refreshShellEnv: vi.fn(async () => ({ PATH: '/managed/bin' }))
}))
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))
vi.mock('../config', async () => {
  const actual = await vi.importActual<typeof DeepSeekHarnessConfigModule>('../config')
  return {
    ...actual,
    writeDeepSeekHarnessConfig: mocks.writeConfig,
    rollbackDeepSeekHarnessConfig: mocks.rollbackConfig
  }
})

const { DeepSeekHarnessService } = await import('../DeepSeekHarnessService')

class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  pid: number
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null

  constructor(pid: number) {
    super()
    this.pid = pid
  }

  close(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exitCode !== null || this.signalCode !== null) return
    this.exitCode = code
    this.signalCode = signal
    this.emit('close', code, signal)
  }
}

const provider = {
  id: 'anthropic',
  name: 'Anthropic',
  authType: 'api-key',
  isEnabled: true,
  authOptional: false,
  apiKeys: [{ id: 'key', isEnabled: true }],
  reportsActualCost: false,
  settings: {},
  endpointConfigs: { [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://api.anthropic.com' } }
} as Provider

const model = {
  id: 'anthropic::claude-sonnet',
  providerId: 'anthropic',
  apiModelId: 'claude-sonnet',
  name: 'Claude Sonnet',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false,
  endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
} as Model

const startInput = {
  mode: 'direct' as const,
  uniqueModelId: 'anthropic::claude-sonnet' as const,
  agentPreset: 'inherit' as const,
  permissionMode: 'workspace-write' as const
}

describe('DeepSeekHarnessService', () => {
  const children: FakeChild[] = []
  let processKill: MockInstance<typeof process.kill>

  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    mocks.isWin = false
    children.length = 0
    mocks.appGetPath.mockImplementation((key: string) => {
      if (key === 'external.deepseek_harness.config') return '/mock/home/.dsh'
      if (key === 'feature.deepseek_harness.workspace') return '/mock/userData/Data/DeepSeekHarness/Workspace'
      throw new Error(`Unexpected application.getPath(${key})`)
    })
    mocks.execFile.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: object,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => callback(null, '', '')
    )
    mocks.appGet.mockImplementation((name: string) => {
      if (name === 'BinaryManager') {
        return {
          getToolSnapshots: vi.fn(async () => ({
            dsh: { availability: { source: 'system', path: '/usr/local/bin/dsh' } }
          }))
        }
      }
      if (name === 'ApiGatewayService') {
        return {
          start: mocks.gatewayStart,
          ensureValidApiKey: mocks.gatewayEnsureKey,
          getCurrentConfig: mocks.gatewayGetConfig
        }
      }
      if (name === 'IpcApiService') {
        return { broadcast: mocks.broadcast }
      }
      throw new Error(`Unexpected application.get(${name})`)
    })
    mocks.providerGet.mockReturnValue(provider)
    mocks.providerGetApiKeys.mockReturnValue([{ id: 'key', key: 'sk-direct', isEnabled: true }])
    mocks.modelGet.mockReturnValue(model)
    mocks.writeConfig.mockResolvedValue({
      credentials: { path: '/mock/home/.dsh/.credentials.yaml', written: 'written credentials' },
      settings: { path: '/mock/home/.dsh/settings.yaml', written: 'written settings' }
    })
    mocks.rollbackConfig.mockResolvedValue(true)
    mocks.gatewayStart.mockResolvedValue(undefined)
    mocks.gatewayEnsureKey.mockResolvedValue('gateway-key')
    mocks.gatewayGetConfig.mockReturnValue({ host: '127.0.0.1', port: 23333 })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 200, body: { cancel: vi.fn(async () => undefined) } }))
    )
    processKill = vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: NodeJS.Signals) => {
      const child = children.find((candidate) => -candidate.pid === pid)
      if (child) queueMicrotask(() => child.close(null, signal ?? 'SIGTERM'))
      return true
    }) as typeof process.kill)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function spawnChild(action: (child: FakeChild) => void): FakeChild {
    const child = new FakeChild(41000 + children.length)
    children.push(child)
    mocks.spawn.mockImplementationOnce(() => {
      queueMicrotask(() => action(child))
      return child as unknown as NodeChildProcess.ChildProcess
    })
    return child
  }

  it('serializes concurrent starts into one child and confirms the ready URL with HTTP 200', async () => {
    spawnChild((child) => child.stdout.write('dsh web: http://127.0.0.1:43123\n'))
    const service = new DeepSeekHarnessService()
    const [first, second] = await Promise.all([service.start(startInput), service.start(startInput)])

    expect(first).toEqual({ success: true, url: 'http://127.0.0.1:43123' })
    expect(second).toEqual(first)
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(mocks.writeConfig).toHaveBeenCalledTimes(2)
    expect(mocks.spawn).toHaveBeenCalledWith(
      '/usr/local/bin/dsh',
      ['web', '--host', '127.0.0.1', '--port', '0', '--no-open'],
      expect.objectContaining({ cwd: '/mock/userData/Data/DeepSeekHarness/Workspace', detached: true })
    )
    expect(mocks.spawn.mock.calls[0][2].env).not.toHaveProperty('CHERRY_STUDIO_CODEMATE_481BD06FDD6C_API_KEY')
    expect(mocks.spawn.mock.calls[0][2].env).not.toHaveProperty('CHERRY_STUDIO_CODEMATE_GATEWAY_API_KEY')
    expect(mocks.spawn.mock.calls[0][2].env).toHaveProperty('CHERRY_STUDIO_CODEMATE_USER_API_KEY', 'unrelated')
    expect(mocks.spawn.mock.calls[0][2].env).toHaveProperty('DSH_PERMISSION_MODE', 'workspace-write')
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:43123/', expect.anything())
    await service.stop()
  })

  it('restarts only the managed child when its launch permission changes', async () => {
    const firstChild = spawnChild((child) => child.stdout.write('dsh web: http://127.0.0.1:43123\n'))
    const secondChild = spawnChild((child) => child.stdout.write('dsh web: http://127.0.0.1:43124\n'))
    const service = new DeepSeekHarnessService()

    await expect(service.start(startInput)).resolves.toMatchObject({ success: true })
    await expect(service.start({ ...startInput, permissionMode: 'read-only' })).resolves.toEqual({
      success: true,
      url: 'http://127.0.0.1:43124'
    })

    expect(processKill).toHaveBeenCalledWith(-firstChild.pid, 'SIGTERM')
    expect(mocks.spawn).toHaveBeenCalledTimes(2)
    expect(mocks.spawn.mock.calls[1][2].env).toHaveProperty('DSH_PERMISSION_MODE', 'read-only')
    expect(secondChild.exitCode).toBeNull()
    await service.stop()
  })

  it('uses an enabled API key obtained through CherryIN-style OAuth in direct mode', async () => {
    mocks.providerGet.mockReturnValue({ ...provider, authType: 'oauth' })
    spawnChild((child) => child.stdout.write('dsh web: http://127.0.0.1:43123\n'))
    const service = new DeepSeekHarnessService()

    await expect(service.start(startInput)).resolves.toEqual({ success: true, url: 'http://127.0.0.1:43123' })
    expect(mocks.writeConfig).toHaveBeenCalledWith(
      '/mock/home/.dsh',
      expect.objectContaining({ credentialValue: 'sk-direct' })
    )
    await service.stop()
  })

  it('does not expose provider request headers through the DeepSeek Harness settings route', async () => {
    mocks.providerGet.mockReturnValue({
      ...provider,
      settings: { extraHeaders: { Authorization: 'Bearer header-secret', 'x-api-key': 'header-secret' } }
    })
    spawnChild((child) => child.stdout.write('dsh web: http://127.0.0.1:43123\n'))
    const service = new DeepSeekHarnessService()

    await expect(service.start(startInput)).resolves.toMatchObject({ success: true })
    expect(mocks.writeConfig.mock.calls[0][1]).not.toHaveProperty('headers')
    await service.stop()
  })

  it('rejects direct mode when an OAuth-obtained API key is no longer available', async () => {
    mocks.providerGet.mockReturnValue({ ...provider, authType: 'oauth' })
    mocks.providerGetApiKeys.mockReturnValue([])

    const result = await new DeepSeekHarnessService().start(startInput)

    expect(result).toEqual({ success: false, message: 'Provider anthropic has no enabled API key' })
    expect(mocks.writeConfig).not.toHaveBeenCalled()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('rejects OAuth-only direct mode even when stale key metadata is present', async () => {
    mocks.providerGet.mockReturnValue({
      ...provider,
      authType: 'oauth',
      authMethods: ['oauth'],
      authOptional: true
    })
    const result = await new DeepSeekHarnessService().start(startInput)

    expect(result).toEqual({ success: false, message: 'This provider must be used through the Unified Gateway' })
    expect(mocks.writeConfig).not.toHaveBeenCalled()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('starts the global gateway and projects its current address, key, and gateway model id', async () => {
    spawnChild((child) => child.stdout.write('dsh web: http://127.0.0.1:43123\n'))
    const service = new DeepSeekHarnessService()
    await expect(
      service.start({
        mode: 'gateway',
        uniqueModelId: 'anthropic::claude-sonnet',
        agentPreset: 'code',
        permissionMode: 'read-only'
      })
    ).resolves.toMatchObject({ success: true })

    expect(mocks.gatewayStart).toHaveBeenCalledOnce()
    expect(mocks.writeConfig).toHaveBeenCalledWith(
      '/mock/home/.dsh',
      expect.objectContaining({
        route: 'cherry-studio-codemate-gateway',
        credentialRef: 'CHERRY_STUDIO_CODEMATE_GATEWAY_API_KEY',
        credentialValue: 'gateway-key',
        protocol: 'openai-completions',
        baseUrl: 'http://127.0.0.1:23333/v1',
        modelId: 'anthropic:claude-sonnet',
        agentPreset: 'code'
      })
    )
    await service.stop()
    expect(mocks.gatewayStart).toHaveBeenCalledOnce()
  })

  it('rolls back configuration and redacts credentials when the child exits before readiness', async () => {
    spawnChild((child) => {
      child.stderr.write('Authorization: Bearer sk-direct\napi_key=sk-direct\n')
      child.close(1, null)
    })
    const result = await new DeepSeekHarnessService().start(startInput)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.message).toContain('<redacted>')
      expect(result.message).not.toContain('sk-direct')
    }
    expect(mocks.rollbackConfig).toHaveBeenCalledOnce()
  })

  it('times out a silent child, terminates only its own process group, and rolls back config', async () => {
    vi.useFakeTimers()
    const child = spawnChild(() => undefined)
    const service = new DeepSeekHarnessService()
    const start = service.start(startInput)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(30_000)
    const result = await start

    expect(result).toEqual({ success: false, message: expect.stringContaining('startup timed out') })
    expect(processKill).toHaveBeenCalledWith(-child.pid, 'SIGTERM')
    expect(mocks.rollbackConfig).toHaveBeenCalledOnce()
  })

  it('escalates from SIGTERM to SIGKILL after the upstream cleanup window', async () => {
    vi.useFakeTimers()
    const child = spawnChild((process) => process.stdout.write('dsh web: http://127.0.0.1:43123\n'))
    processKill.mockImplementation(((pid: number, signal?: NodeJS.Signals) => {
      if (signal === 'SIGKILL') queueMicrotask(() => child.close(null, signal))
      return pid === -child.pid
    }) as typeof process.kill)
    const service = new DeepSeekHarnessService()
    const start = service.start(startInput)
    await vi.advanceTimersByTimeAsync(0)
    await expect(start).resolves.toMatchObject({ success: true })

    const stop = service.stop()
    await vi.advanceTimersByTimeAsync(3000)
    await stop
    expect(processKill).toHaveBeenNthCalledWith(1, -child.pid, 'SIGTERM')
    expect(processKill).toHaveBeenNthCalledWith(2, -child.pid, 'SIGKILL')
    expect(service.getStatus()).toEqual({ status: 'stopped' })
  })

  it('terminates the complete Windows process tree before accepting wrapper exit', async () => {
    mocks.isWin = true
    const child = spawnChild((process) => process.stdout.write('dsh web: http://127.0.0.1:43123\n'))
    mocks.execFile.mockImplementationOnce(
      (
        _file: string,
        _args: string[],
        _options: object,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        child.close(null, 'SIGTERM')
        callback(null, '', '')
      }
    )
    const service = new DeepSeekHarnessService()
    await expect(service.start(startInput)).resolves.toMatchObject({ success: true })

    await service.stop()

    expect(mocks.execFile).toHaveBeenCalledWith(
      'taskkill',
      ['/PID', String(child.pid), '/T'],
      { windowsHide: true },
      expect.any(Function)
    )
    expect(processKill).not.toHaveBeenCalled()
  })

  it('bounds graceful and forced termination below the lifecycle stop ceiling', async () => {
    vi.useFakeTimers()
    const child = spawnChild((process) => process.stdout.write('dsh web: http://127.0.0.1:43123\n'))
    processKill.mockImplementation(() => true)
    const service = new DeepSeekHarnessService()
    const start = service.start(startInput)
    await vi.advanceTimersByTimeAsync(0)
    await expect(start).resolves.toMatchObject({ success: true })

    const stop = expect(service.stop()).rejects.toThrow('did not exit after forced termination')
    await vi.advanceTimersByTimeAsync(4000)

    await stop
    expect(processKill).toHaveBeenNthCalledWith(1, -child.pid, 'SIGTERM')
    expect(processKill).toHaveBeenNthCalledWith(2, -child.pid, 'SIGKILL')
  })

  it('uses child exit confirmation during application shutdown without probing HTTP again', async () => {
    spawnChild((child) => child.stdout.write('dsh web: http://127.0.0.1:43123\n'))
    const service = new DeepSeekHarnessService()
    await expect(service.start(startInput)).resolves.toMatchObject({ success: true })
    expect(fetch).toHaveBeenCalledOnce()

    await service._doStop()
    expect(fetch).toHaveBeenCalledOnce()
    expect(processKill).toHaveBeenCalledWith(-children[0].pid, 'SIGTERM')
  })

  it('interrupts a pending startup when application shutdown begins', async () => {
    spawnChild(() => undefined)
    const service = new DeepSeekHarnessService()
    const start = service.start(startInput)
    await vi.waitFor(() => expect(service.getStatus().status).toBe('starting'))

    await service._doStop()
    await expect(start).resolves.toEqual({ success: false, message: 'DeepSeek Harness startup was cancelled' })
    expect(processKill).toHaveBeenCalledWith(-children[0].pid, 'SIGTERM')
    expect(service.getStatus()).toEqual({ status: 'stopped' })
  })

  describe('status change broadcasts', () => {
    const statusPayloads = () =>
      mocks.broadcast.mock.calls
        .filter(([name]) => name === 'deepseek_harness.status_changed')
        .map(([, payload]) => payload)

    it('broadcasts starting then running with the get_status payload shape on a successful start', async () => {
      spawnChild((child) => child.stdout.write('dsh web: http://127.0.0.1:43123\n'))
      const service = new DeepSeekHarnessService()

      await expect(service.start(startInput)).resolves.toMatchObject({ success: true })

      expect(statusPayloads()).toEqual([{ status: 'starting' }, { status: 'running', url: 'http://127.0.0.1:43123' }])
      await service.stop()
    })

    it('broadcasts error when the launch fails', async () => {
      spawnChild((child) => {
        child.stderr.write('boom\n')
        child.close(1, null)
      })
      const service = new DeepSeekHarnessService()

      await expect(service.start(startInput)).resolves.toMatchObject({ success: false })

      expect(statusPayloads().at(-1)).toEqual({ status: 'error' })
    })

    it('does not broadcast stopped while cleaning up a failed launch', async () => {
      // Timeout failure with the child still alive: cleanup kills it after the
      // terminal 'error' state is set, and the termination handler must stay quiet.
      vi.useFakeTimers()
      spawnChild(() => undefined)
      const service = new DeepSeekHarnessService()
      const start = service.start(startInput)
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(30_000)
      const result = await start

      expect(result.success).toBe(false)
      expect(statusPayloads()).toEqual([{ status: 'starting' }, { status: 'error' }])
      expect(service.getStatus()).toEqual({ status: 'error' })
    })

    it('broadcasts error immediately when the running child is killed, without waiting for a poll', async () => {
      const child = spawnChild((process) => process.stdout.write('dsh web: http://127.0.0.1:43123\n'))
      const service = new DeepSeekHarnessService()
      await expect(service.start(startInput)).resolves.toMatchObject({ success: true })
      mocks.broadcast.mockClear()

      child.close(137, null)

      expect(statusPayloads()).toEqual([{ status: 'error' }])
      expect(service.getStatus()).toEqual({ status: 'error' })
    })

    it('announces stopped exactly once when a stop completes', async () => {
      spawnChild((child) => child.stdout.write('dsh web: http://127.0.0.1:43123\n'))
      const service = new DeepSeekHarnessService()
      await expect(service.start(startInput)).resolves.toMatchObject({ success: true })

      await service.stop()

      // The termination handler and stop() both reach setStatus, but same-value calls
      // are not transitions — the terminal 'stopped' must broadcast exactly once.
      expect(statusPayloads()).toEqual([
        { status: 'starting' },
        { status: 'running', url: 'http://127.0.0.1:43123' },
        { status: 'stopped' }
      ])
      expect(service.getStatus()).toEqual({ status: 'stopped' })
    })

    it('rebroadcasts running when a start hits the already-running fast path', async () => {
      spawnChild((child) => child.stdout.write('dsh web: http://127.0.0.1:43123\n'))
      const service = new DeepSeekHarnessService()
      await expect(service.start(startInput)).resolves.toMatchObject({ success: true })
      mocks.broadcast.mockClear()

      await expect(service.start(startInput)).resolves.toMatchObject({ success: true })

      // The idempotent success is not a transition, but a renderer that missed the
      // original running event must still be corrected by this request.
      expect(statusPayloads()).toEqual([{ status: 'running', url: 'http://127.0.0.1:43123' }])
    })

    it('confirms stopped on a no-op stop of an already-stopped harness', async () => {
      const service = new DeepSeekHarnessService()

      await service.stop()

      expect(statusPayloads()).toEqual([{ status: 'stopped' }])
    })

    it('completes the transition even when broadcasting fails', async () => {
      mocks.broadcast.mockImplementation(() => {
        throw new Error('broadcast transport unavailable')
      })
      spawnChild((child) => child.stdout.write('dsh web: http://127.0.0.1:43123\n'))
      const service = new DeepSeekHarnessService()

      await expect(service.start(startInput)).resolves.toMatchObject({ success: true })
      expect(service.getStatus()).toEqual({ status: 'running', url: 'http://127.0.0.1:43123' })
    })
  })
})
