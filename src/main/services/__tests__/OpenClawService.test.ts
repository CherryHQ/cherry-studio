import fs from 'node:fs'

import type { Model, Provider } from '@types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { parseCurrentVersion, parseUpdateStatus } from '../utils/openClawParsers'

// --- Mocks for OpenClawService dependencies ---

vi.mock('@main/services/WindowService', () => ({
  windowService: {
    getMainWindow: vi.fn(() => ({
      webContents: { send: vi.fn() }
    }))
  }
}))

vi.mock('@main/utils/process', () => ({
  crossPlatformSpawn: vi.fn(),
  findExecutableInEnv: vi.fn(),
  getBinaryPath: vi.fn(() => Promise.resolve('/mock/bin/openclaw')),
  runInstallScript: vi.fn()
}))

vi.mock('@main/utils/shell-env', () => ({
  default: vi.fn(() => Promise.resolve({ PATH: '/usr/bin' })),
  refreshShellEnv: vi.fn(() => Promise.resolve({ PATH: '/usr/bin' }))
}))

vi.mock('@main/utils/ipService', () => ({
  isUserInChina: vi.fn(() => Promise.resolve(false))
}))

vi.mock('@main/constant', () => ({
  isWin: false
}))

vi.mock('@shared/IpcChannel', () => ({
  IpcChannel: { OpenClaw_InstallProgress: 'openclaw:install-progress' }
}))

vi.mock('@shared/utils', () => ({
  hasAPIVersion: vi.fn(() => false),
  withoutTrailingSlash: vi.fn((url: string) => url.replace(/\/+$/, ''))
}))

// openClawParsers: not mocked — tested directly below

vi.mock('../VertexAIService', () => ({
  default: { getInstance: vi.fn() }
}))

// --- Import service after mocks are set up ---

async function createService() {
  const mod = await import('../OpenClawService')
  return mod.openClawService
}

// --- syncProviderConfig tests ---

const mockProvider: Provider = {
  id: 'test-provider',
  name: 'Test Provider',
  type: 'openai',
  apiKey: 'sk-test-key',
  apiHost: 'https://api.test.com',
  enabled: true,
  isSystem: false,
  models: [
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'test-provider' } as Model,
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'test-provider' } as Model
  ]
} as Provider

const mockPrimaryModel: Model = {
  id: 'gpt-4o',
  name: 'GPT-4o',
  provider: 'test-provider'
} as Model

const mockVisionModel: Model = {
  id: 'gpt-4o-mini',
  name: 'GPT-4o Mini',
  provider: 'test-provider'
} as Model

const mockEvent = {} as Electron.IpcMainInvokeEvent

describe('OpenClawService.syncProviderConfig', () => {
  let service: Awaited<ReturnType<typeof createService>>

  beforeEach(async () => {
    vi.clearAllMocks()
    service = await createService()
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.writeFileSync).mockImplementation(() => {})
    vi.mocked(fs.mkdirSync).mockImplementation(() => '' as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function getWrittenConfig(): Record<string, any> {
    const call = vi.mocked(fs.writeFileSync).mock.calls[0]
    return JSON.parse(call[1] as string)
  }

  it('sets primary model without imageModel when no vision model provided', async () => {
    const result = await service.syncProviderConfig(mockEvent, mockProvider, mockPrimaryModel)

    expect(result.success).toBe(true)

    const config = getWrittenConfig()
    expect(config.agents.defaults.model).toEqual({
      primary: 'cherry-test-provider/gpt-4o',
      input: ['text', 'image']
    })
    expect(config.agents.defaults.imageModel).toBeUndefined()
  })

  it('sets imageModel at agents.defaults level when vision model provided', async () => {
    const result = await service.syncProviderConfig(mockEvent, mockProvider, mockPrimaryModel, mockVisionModel)

    expect(result.success).toBe(true)

    const config = getWrittenConfig()
    expect(config.agents.defaults.model).toEqual({
      primary: 'cherry-test-provider/gpt-4o',
      input: ['text', 'image']
    })
    expect(config.agents.defaults.imageModel).toEqual({
      primary: 'cherry-test-provider/gpt-4o-mini',
      input: ['text', 'image']
    })
  })

  it('removes existing imageModel when vision model is not provided', async () => {
    const existingConfig = {
      agents: {
        defaults: {
          model: { primary: 'old/model' },
          imageModel: { primary: 'old/vision-model' }
        }
      }
    }
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return String(p).includes('openclaw.json') && !String(p).includes('.bak') && !String(p).includes('.cherry')
    })
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingConfig))

    const result = await service.syncProviderConfig(mockEvent, mockProvider, mockPrimaryModel)

    expect(result.success).toBe(true)

    const config = getWrittenConfig()
    expect(config.agents.defaults.imageModel).toBeUndefined()
  })

  it('overwrites existing imageModel when new vision model provided', async () => {
    const existingConfig = {
      agents: {
        defaults: {
          model: { primary: 'old/model' },
          imageModel: { primary: 'old/vision-model' }
        }
      }
    }
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return String(p).includes('openclaw.json') && !String(p).includes('.bak') && !String(p).includes('.cherry')
    })
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingConfig))

    const result = await service.syncProviderConfig(mockEvent, mockProvider, mockPrimaryModel, mockVisionModel)

    expect(result.success).toBe(true)

    const config = getWrittenConfig()
    expect(config.agents.defaults.imageModel).toEqual({
      primary: 'cherry-test-provider/gpt-4o-mini',
      input: ['text', 'image']
    })
  })

  it('writes provider config with correct structure', async () => {
    await service.syncProviderConfig(mockEvent, mockProvider, mockPrimaryModel, mockVisionModel)

    const config = getWrittenConfig()

    // Verify provider config
    const providerConfig = config.models.providers['cherry-test-provider']
    expect(providerConfig).toBeDefined()
    expect(providerConfig.apiKey).toBe('sk-test-key')
    expect(providerConfig.models).toHaveLength(2)

    // Verify gateway config
    expect(config.gateway.mode).toBe('local')
    expect(config.gateway.auth.token).toBeDefined()
  })
})

// --- Gateway status state machine tests ---

describe('OpenClawService gateway status state machine', () => {
  let service: Awaited<ReturnType<typeof createService>>
  let checkHealthSpy: ReturnType<typeof vi.spyOn>
  let findBinarySpy: ReturnType<typeof vi.spyOn>
  let checkPortOpenSpy: ReturnType<typeof vi.spyOn>
  let startAndWaitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.clearAllMocks()
    service = await createService()

    // Reset internal state to 'stopped' via reflection
    // @ts-expect-error -- accessing private field for testing
    service.gatewayStatus = 'stopped'
    // @ts-expect-error -- accessing private field for testing
    service.gatewayPort = 18790
    // @ts-expect-error -- accessing private field for testing
    service.gatewayAuthToken = ''

    // Spy on private methods via prototype
    checkHealthSpy = vi.spyOn(service as any, 'checkGatewayHealth')
    findBinarySpy = vi.spyOn(service as any, 'findOpenClawBinary')
    checkPortOpenSpy = vi.spyOn(service as any, 'checkPortOpen')
    startAndWaitSpy = vi.spyOn(service as any, 'startAndWaitForGateway')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ─── getStatus ───────────────────────────────────────────────

  describe('getStatus', () => {
    it('returns "starting" immediately without probing health', async () => {
      // @ts-expect-error -- accessing private field
      service.gatewayStatus = 'starting'

      const result = await service.getStatus()

      expect(result).toEqual({ status: 'starting', port: 18790 })
      expect(checkHealthSpy).not.toHaveBeenCalled()
    })

    it('detects externally running gateway when stopped', async () => {
      // @ts-expect-error -- accessing private field
      service.gatewayStatus = 'stopped'
      checkHealthSpy.mockResolvedValue({ status: 'healthy', gatewayPort: 18790 })

      const result = await service.getStatus()

      expect(result).toEqual({ status: 'running', port: 18790 })
    })

    it('detects externally running gateway when in error state', async () => {
      // @ts-expect-error -- accessing private field
      service.gatewayStatus = 'error'
      checkHealthSpy.mockResolvedValue({ status: 'healthy', gatewayPort: 18790 })

      const result = await service.getStatus()

      expect(result).toEqual({ status: 'running', port: 18790 })
    })

    it('detects crashed gateway and transitions running → stopped', async () => {
      // @ts-expect-error -- accessing private field
      service.gatewayStatus = 'running'
      checkHealthSpy.mockResolvedValue({ status: 'unhealthy', gatewayPort: 18790 })

      const result = await service.getStatus()

      expect(result).toEqual({ status: 'stopped', port: 18790 })
    })

    it('stays running when health probe is healthy', async () => {
      // @ts-expect-error -- accessing private field
      service.gatewayStatus = 'running'
      checkHealthSpy.mockResolvedValue({ status: 'healthy', gatewayPort: 18790 })

      const result = await service.getStatus()

      expect(result).toEqual({ status: 'running', port: 18790 })
    })

    it('stays stopped when health probe is unhealthy', async () => {
      // @ts-expect-error -- accessing private field
      service.gatewayStatus = 'stopped'
      checkHealthSpy.mockResolvedValue({ status: 'unhealthy', gatewayPort: 18790 })

      const result = await service.getStatus()

      expect(result).toEqual({ status: 'stopped', port: 18790 })
    })

    it('stays in error when health probe is unhealthy', async () => {
      // @ts-expect-error -- accessing private field
      service.gatewayStatus = 'error'
      checkHealthSpy.mockResolvedValue({ status: 'unhealthy', gatewayPort: 18790 })

      const result = await service.getStatus()

      expect(result).toEqual({ status: 'error', port: 18790 })
    })
  })

  // ─── checkHealth ─────────────────────────────────────────────

  describe('checkHealth', () => {
    it('returns unhealthy immediately when status is stopped', async () => {
      // @ts-expect-error -- accessing private field
      service.gatewayStatus = 'stopped'

      const result = await service.checkHealth()

      expect(result).toEqual({ status: 'unhealthy', gatewayPort: 18790 })
      expect(checkHealthSpy).not.toHaveBeenCalled()
    })

    it('returns unhealthy immediately when status is error', async () => {
      // @ts-expect-error -- accessing private field
      service.gatewayStatus = 'error'

      const result = await service.checkHealth()

      expect(result).toEqual({ status: 'unhealthy', gatewayPort: 18790 })
      expect(checkHealthSpy).not.toHaveBeenCalled()
    })

    it('returns unhealthy immediately when status is starting', async () => {
      // @ts-expect-error -- accessing private field
      service.gatewayStatus = 'starting'

      const result = await service.checkHealth()

      expect(result).toEqual({ status: 'unhealthy', gatewayPort: 18790 })
      expect(checkHealthSpy).not.toHaveBeenCalled()
    })

    it('probes and returns healthy when gateway is running and reachable', async () => {
      // @ts-expect-error -- accessing private field
      service.gatewayStatus = 'running'
      checkHealthSpy.mockResolvedValue({ status: 'healthy', gatewayPort: 18790 })

      const result = await service.checkHealth()

      expect(result).toEqual({ status: 'healthy', gatewayPort: 18790 })
      // @ts-expect-error -- accessing private field
      expect(service.gatewayStatus).toBe('running')
    })

    it('transitions running → stopped when probe returns unhealthy', async () => {
      // @ts-expect-error -- accessing private field
      service.gatewayStatus = 'running'
      checkHealthSpy.mockResolvedValue({ status: 'unhealthy', gatewayPort: 18790 })

      const result = await service.checkHealth()

      expect(result).toEqual({ status: 'unhealthy', gatewayPort: 18790 })
      // @ts-expect-error -- accessing private field
      expect(service.gatewayStatus).toBe('stopped')
    })
  })

  // ─── startGateway ────────────────────────────────────────────

  describe('startGateway', () => {
    const event = {} as Electron.IpcMainInvokeEvent

    it('rejects concurrent startup calls', async () => {
      // @ts-expect-error -- accessing private field
      service.gatewayStatus = 'starting'

      const result = await service.startGateway(event)

      expect(result).toEqual({ success: false, message: 'Gateway is already starting' })
    })

    it('stops stale gateway and restarts when port is in use by our gateway', async () => {
      // First call: port occupied; after stop: port free
      checkPortOpenSpy.mockResolvedValueOnce(true).mockResolvedValue(false)
      checkHealthSpy
        .mockResolvedValueOnce({ status: 'healthy', gatewayPort: 18790 }) // startGateway detects our gateway
        .mockResolvedValue({ status: 'unhealthy', gatewayPort: 18790 }) // waitForGatewayStop confirms stopped
      findBinarySpy.mockResolvedValue('/mock/bin/openclaw')
      startAndWaitSpy.mockResolvedValue(undefined)

      const result = await service.startGateway(event)

      expect(result).toEqual({ success: true })
      // @ts-expect-error -- accessing private field
      expect(service.gatewayStatus).toBe('running')
    })

    it('fails when port is in use by another application', async () => {
      checkPortOpenSpy.mockResolvedValue(true)
      checkHealthSpy.mockResolvedValue({ status: 'unhealthy', gatewayPort: 18790 })

      const result = await service.startGateway(event)

      expect(result.success).toBe(false)
      expect('message' in result && result.message).toContain('already in use')
    })

    it('fails when binary is not found', async () => {
      checkPortOpenSpy.mockResolvedValue(false)
      findBinarySpy.mockResolvedValue(null)

      const result = await service.startGateway(event)

      expect(result).toEqual({
        success: false,
        message: 'OpenClaw binary not found. Please install OpenClaw first.'
      })
    })

    it('transitions to running on successful start', async () => {
      checkPortOpenSpy.mockResolvedValue(false)
      findBinarySpy.mockResolvedValue('/mock/bin/openclaw')
      startAndWaitSpy.mockResolvedValue(undefined)

      const result = await service.startGateway(event)

      expect(result).toEqual({ success: true })
      // @ts-expect-error -- accessing private field
      expect(service.gatewayStatus).toBe('running')
    })

    it('transitions to error when start fails', async () => {
      checkPortOpenSpy.mockResolvedValue(false)
      findBinarySpy.mockResolvedValue('/mock/bin/openclaw')
      startAndWaitSpy.mockRejectedValue(new Error('Gateway timeout'))

      const result = await service.startGateway(event)

      expect(result).toEqual({ success: false, message: 'Gateway timeout' })
      // @ts-expect-error -- accessing private field
      expect(service.gatewayStatus).toBe('error')
    })

    it('sets status to starting during startup', async () => {
      checkPortOpenSpy.mockResolvedValue(false)
      findBinarySpy.mockResolvedValue('/mock/bin/openclaw')

      let statusDuringStart: string | undefined
      startAndWaitSpy.mockImplementation(async () => {
        // @ts-expect-error -- accessing private field
        statusDuringStart = service.gatewayStatus
      })

      await service.startGateway(event)

      expect(statusDuringStart).toBe('starting')
    })

    it('uses custom port when provided', async () => {
      checkPortOpenSpy.mockResolvedValue(false)
      findBinarySpy.mockResolvedValue('/mock/bin/openclaw')
      startAndWaitSpy.mockResolvedValue(undefined)

      await service.startGateway(event, 9999)

      // @ts-expect-error -- accessing private field
      expect(service.gatewayPort).toBe(9999)
    })
  })

  // ─── stopGateway ─────────────────────────────────────────────

  describe('stopGateway', () => {
    it('transitions to stopped on successful stop', async () => {
      // @ts-expect-error -- accessing private field
      service.gatewayStatus = 'running'
      checkHealthSpy.mockResolvedValue({ status: 'unhealthy', gatewayPort: 18790 }) // gateway stopped

      const result = await service.stopGateway()

      expect(result).toEqual({ success: true })
      // @ts-expect-error -- accessing private field
      expect(service.gatewayStatus).toBe('stopped')
    })

    it('transitions to error when gateway fails to stop', async () => {
      // @ts-expect-error -- accessing private field
      service.gatewayStatus = 'running'
      checkHealthSpy.mockResolvedValue({ status: 'healthy', gatewayPort: 18790 }) // still running

      const result = await service.stopGateway()

      expect(result.success).toBe(false)
      // @ts-expect-error -- accessing private field
      expect(service.gatewayStatus).toBe('error')
    })
  })

  // ─── Full state transition scenarios ─────────────────────────

  describe('full lifecycle transitions', () => {
    const event = {} as Electron.IpcMainInvokeEvent

    it('stopped → starting → running → (crash) → stopped', async () => {
      // @ts-expect-error -- accessing private field
      expect(service.gatewayStatus).toBe('stopped')

      // Start
      checkPortOpenSpy.mockResolvedValue(false)
      findBinarySpy.mockResolvedValue('/mock/bin/openclaw')
      startAndWaitSpy.mockResolvedValue(undefined)
      await service.startGateway(event)
      // @ts-expect-error -- accessing private field
      expect(service.gatewayStatus).toBe('running')

      // Gateway crashes externally — getStatus detects it
      checkHealthSpy.mockResolvedValue({ status: 'unhealthy', gatewayPort: 18790 })
      const status = await service.getStatus()
      expect(status.status).toBe('stopped')
    })

    it('stopped → starting → error → (external recovery) → running', async () => {
      // Start fails
      checkPortOpenSpy.mockResolvedValue(false)
      findBinarySpy.mockResolvedValue('/mock/bin/openclaw')
      startAndWaitSpy.mockRejectedValue(new Error('timeout'))
      await service.startGateway(event)
      // @ts-expect-error -- accessing private field
      expect(service.gatewayStatus).toBe('error')

      // External recovery — someone starts gateway manually
      checkHealthSpy.mockResolvedValue({ status: 'healthy', gatewayPort: 18790 })
      const status = await service.getStatus()
      expect(status.status).toBe('running')
    })

    it('running → checkHealth unhealthy → stopped → getStatus healthy → running', async () => {
      // @ts-expect-error -- accessing private field
      service.gatewayStatus = 'running'

      // checkHealth detects crash
      checkHealthSpy.mockResolvedValue({ status: 'unhealthy', gatewayPort: 18790 })
      await service.checkHealth()
      // @ts-expect-error -- accessing private field
      expect(service.gatewayStatus).toBe('stopped')

      // getStatus detects recovery
      checkHealthSpy.mockResolvedValue({ status: 'healthy', gatewayPort: 18790 })
      const status = await service.getStatus()
      expect(status.status).toBe('running')
    })
  })
})

// ─── Parser tests (preserved from original) ─────────────────────

describe('parseCurrentVersion', () => {
  const cases = [
    { name: 'standard version output', input: 'OpenClaw 2026.3.9 (fe96034)', expected: '2026.3.9' },
    { name: 'version without commit hash', input: 'OpenClaw 2026.3.11', expected: '2026.3.11' },
    { name: 'lowercase prefix', input: 'openclaw 1.0.0 (abc1234)', expected: '1.0.0' },
    { name: 'semver format', input: 'OpenClaw 0.12.3 (deadbeef)', expected: '0.12.3' },
    { name: 'empty string', input: '', expected: null },
    { name: 'unrelated output', input: 'some random text', expected: null },
    { name: 'version with extra whitespace', input: '  OpenClaw  2026.3.9  ', expected: '2026.3.9' }
  ]

  it.each(cases)('$name: "$input"', ({ input, expected }) => {
    expect(parseCurrentVersion(input)).toBe(expected)
  })

  it('snapshot: all cases', () => {
    const results = Object.fromEntries(cases.map((c) => [c.name, parseCurrentVersion(c.input)]))
    expect(results).toMatchInlineSnapshot(`
      {
        "empty string": null,
        "lowercase prefix": "1.0.0",
        "semver format": "0.12.3",
        "standard version output": "2026.3.9",
        "unrelated output": null,
        "version with extra whitespace": "2026.3.9",
        "version without commit hash": "2026.3.11",
      }
    `)
  })
})

describe('parseUpdateStatus', () => {
  const cases = [
    {
      name: 'binary update via summary line',
      input: 'Update available (binary 2026.3.12). Run: openclaw update',
      expected: '2026.3.12'
    },
    {
      name: 'binary update via table row',
      input: 'available · binary · 2026.3.12',
      expected: '2026.3.12'
    },
    {
      name: 'binary update with semver',
      input: 'Update available (binary 1.2.3). Run: openclaw update',
      expected: '1.2.3'
    },
    {
      name: 'full table output with binary update',
      input: [
        'OpenClaw update status',
        '┌──────────┬─────────────────────────────────┐',
        '│ Install  │ binary (~/.cherrystudio/bin)     │',
        '│ Channel  │ stable (default)                 │',
        '│ Update   │ available · binary · 2026.3.12   │',
        '└──────────┴─────────────────────────────────┘',
        '',
        'Update available (binary 2026.3.12). Run: openclaw update'
      ].join('\n'),
      expected: '2026.3.12'
    },
    {
      name: 'ignores npm update (summary)',
      input: 'Update available (npm 2026.3.11). Run: openclaw update',
      expected: null
    },
    {
      name: 'ignores pkg update (table row)',
      input: 'Update available · pkg · npm update 2026.3.11',
      expected: null
    },
    {
      name: 'ignores pkg update in full table output',
      input: [
        'OpenClaw update status',
        '┌──────────┬─────────────────────────────────┐',
        '│ Install  │ binary (~/.cherrystudio/bin)     │',
        '│ Channel  │ stable (default)                 │',
        '│ Update   │ available · pkg · npm update 2026.3.11 │',
        '└──────────┴─────────────────────────────────┘',
        '',
        'Update available (npm 2026.3.11). Run: openclaw update'
      ].join('\n'),
      expected: null
    },
    { name: 'no update available', input: 'Already up to date', expected: null },
    { name: 'empty string', input: '', expected: null },
    { name: 'unrelated output', input: 'some random text', expected: null }
  ]

  it.each(cases)('$name', ({ input, expected }) => {
    expect(parseUpdateStatus(input)).toBe(expected)
  })

  it('snapshot: all cases', () => {
    const results = Object.fromEntries(cases.map((c) => [c.name, parseUpdateStatus(c.input)]))
    expect(results).toMatchInlineSnapshot(`
      {
        "binary update via summary line": "2026.3.12",
        "binary update via table row": "2026.3.12",
        "binary update with semver": "1.2.3",
        "empty string": null,
        "full table output with binary update": "2026.3.12",
        "ignores npm update (summary)": null,
        "ignores pkg update (table row)": null,
        "ignores pkg update in full table output": null,
        "no update available": null,
        "unrelated output": null,
      }
    `)
  })
})
