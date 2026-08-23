import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'

import { application } from '@application'
import { ENDPOINT_TYPE, type Model as DataModel, MODEL_CAPABILITY, type UniqueModelId } from '@shared/data/types/model'
import type { Provider as DataProvider } from '@shared/data/types/provider'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const binaryManagerMock = vi.hoisted(() => ({ getToolSnapshots: vi.fn() }))
const crossPlatformSpawnMock = vi.hoisted(() => vi.fn())
const platformMock = vi.hoisted(() => ({ isWin: false }))
const broadcastMock = vi.hoisted(() => vi.fn())

function createSpawnChild() {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
    unref: vi.fn()
  })
}

function queueSpawnResult({ stdout = '', stderr = '', exitCode = 0 } = {}) {
  const child = createSpawnChild()

  crossPlatformSpawnMock.mockImplementationOnce(() => {
    queueMicrotask(() => {
      child.stdout.write(stdout)
      child.stderr.write(stderr)
      child.stdout.end()
      child.stderr.end()
      child.emit('exit', exitCode, null)
      child.emit('close', exitCode, null)
    })
    return child
  })

  return child
}

function createRuntimeConfigSchema(
  modelFields = ['contextWindow', 'maxTokens', 'reasoning', 'input', 'cost'],
  providerFields = ['headers']
) {
  return {
    type: 'object',
    properties: {
      models: {
        type: 'object',
        properties: {
          providers: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ...Object.fromEntries(providerFields.map((field) => [field, {}])),
                models: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: Object.fromEntries(modelFields.map((field) => [field, {}]))
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

// --- Mocks for OpenClawService dependencies ---

vi.mock('@main/core/lifecycle', () => {
  class MockBaseService {}
  return {
    BaseService: MockBaseService,
    Injectable: () => (target: unknown) => target,
    ServicePhase: () => (target: unknown) => target,
    DependsOn: () => (target: unknown) => target,
    Phase: { Background: 'background', WhenReady: 'whenReady', BeforeReady: 'beforeReady' }
  }
})

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'MainWindowService') {
        return {
          getMainWindow: vi.fn(() => ({
            webContents: { send: vi.fn() }
          }))
        }
      }
      if (name === 'WindowManager') {
        return { broadcastToType: vi.fn(), getWindowsByType: vi.fn(() => []) }
      }
      if (name === 'BinaryManager') return binaryManagerMock
      if (name === 'IpcApiService') return { broadcast: broadcastMock }
      if (name === 'PreferenceService') return { get: vi.fn(() => 'en-US') }
      throw new Error(`[MockApplication] Unknown service: ${name}`)
    }),
    getPath: vi.fn()
  }
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: {
    getByKey: vi.fn(),
    list: vi.fn()
  }
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    getApiKeys: vi.fn(),
    getByProviderId: vi.fn()
  }
}))

vi.mock('@main/utils/shellEnv', () => ({
  refreshShellEnv: vi.fn(() => Promise.resolve({ PATH: '/mock/bin:/usr/bin', MISE_DATA_DIR: '/mock/mise' })),
  getRawShellEnv: vi.fn(() => Promise.resolve({ PATH: '/usr/local/bin:/usr/bin', MISE_DATA_DIR: '/user/mise' }))
}))

vi.mock('@main/services/RegionService', () => ({
  regionService: { isInChina: vi.fn(() => Promise.resolve(false)) }
}))

// Pin Windows behavior without depending on the host platform.
vi.mock('@main/core/platform', () => ({
  get isWin() {
    return platformMock.isWin
  }
}))

vi.mock('@main/utils/processRunner', () => ({
  crossPlatformSpawn: crossPlatformSpawnMock
}))

vi.mock('@shared/utils', () => ({
  hasApiVersion: vi.fn(() => false),
  withoutTrailingSlash: vi.fn((url: string) => url.replace(/\/+$/, ''))
}))

// openClawParsers: not mocked — tested directly below

vi.mock('../VertexAiService', () => ({
  vertexAiService: { getAccessToken: vi.fn(() => Promise.resolve('mock-token')) }
}))

// --- Import service after mocks are set up ---

async function createService() {
  const { OpenClawService } = await import('../OpenClawService')
  return new OpenClawService()
}

function createProvider(overrides: Partial<DataProvider> = {}): DataProvider {
  return {
    id: 'openai',
    name: 'OpenAI',
    endpointConfigs: {
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.openai.com' }
    },
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    apiKeys: [{ id: 'key-1', label: 'Primary', isEnabled: true }],
    authType: 'api-key',
    reportsActualCost: false,
    settings: {},
    isEnabled: true,
    ...overrides
  }
}

function createModel(overrides: Partial<DataModel> = {}): DataModel {
  return {
    id: 'openai::gpt-4o',
    providerId: 'openai',
    apiModelId: 'gpt-4o',
    name: 'GPT-4o',
    capabilities: [],
    endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  }
}

describe('OpenClawService gateway status state machine', () => {
  let service: Awaited<ReturnType<typeof createService>>
  let checkHealthSpy: ReturnType<typeof vi.spyOn>
  let findBinarySpy: ReturnType<typeof vi.spyOn>
  let checkPortOpenSpy: ReturnType<typeof vi.spyOn>
  let startAndWaitSpy: ReturnType<typeof vi.spyOn>
  let runOpenClawCommandSpy: ReturnType<typeof vi.spyOn>
  let schemaCapabilitySpy: ReturnType<typeof vi.spyOn>
  let validateConfigSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.clearAllMocks()
    platformMock.isWin = false
    binaryManagerMock.getToolSnapshots.mockResolvedValue({
      openclaw: { name: 'openclaw', availability: { source: 'mise', path: '/mock/bin/openclaw', version: '1.0.0' } }
    })
    vi.mocked(application.getPath).mockReturnValue('/mock/openclaw')
    service = await createService()

    // Reset internal state via reflection
    ;(service as any).gatewayStatus = 'stopped'
    ;(service as any).gatewayPort = 18790
    ;(service as any).gatewayAuthToken = ''

    // Spy on private methods via prototype
    checkHealthSpy = vi.spyOn(service as any, 'checkGatewayHealth')
    findBinarySpy = vi.spyOn(service as any, 'findOpenClawBinary')
    checkPortOpenSpy = vi.spyOn(service as any, 'checkPortOpen')
    startAndWaitSpy = vi.spyOn(service as any, 'startAndWaitForGateway')
    runOpenClawCommandSpy = vi.spyOn(service as any, 'runOpenClawCommand').mockResolvedValue({
      exitCode: 0,
      stdout: '{}',
      stderr: '',
      outputTruncated: false
    })
    schemaCapabilitySpy = vi
      .spyOn(service as any, 'assertSchemaCapability')
      .mockResolvedValue(createRuntimeConfigSchema())
    validateConfigSpy = vi.spyOn(service as any, 'validateConfig').mockResolvedValue({
      valid: true,
      path: '/mock/.openclaw/openclaw.json',
      issues: [],
      warnings: []
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('OpenClaw config preflight boundaries', () => {
    it('preserves JSON validation output when validate exits with code 1', async () => {
      runOpenClawCommandSpy.mockRestore()
      const stdout = JSON.stringify({
        valid: false,
        issues: [{ path: 'models.providers.cherry-openai.apiKey', message: 'Invalid value' }]
      })
      queueSpawnResult({ stdout, stderr: 'configuration rejected', exitCode: 1 })

      await expect(
        (service as any).runOpenClawCommand('/mock/bin/openclaw', ['config', 'validate', '--json'], {
          PATH: '/mock/bin'
        })
      ).resolves.toEqual({
        exitCode: 1,
        stdout,
        stderr: 'configuration rejected',
        outputTruncated: false
      })
      expect(crossPlatformSpawnMock).toHaveBeenCalledWith(
        '/mock/bin/openclaw',
        ['config', 'validate', '--json'],
        expect.objectContaining({
          env: { PATH: '/mock/bin' },
          stdio: ['ignore', 'pipe', 'pipe']
        })
      )
    })

    it('reports binary incompatibility when the schema command is unavailable', async () => {
      runOpenClawCommandSpy.mockRestore()
      schemaCapabilitySpy.mockRestore()
      queueSpawnResult({ stderr: 'error: unknown command schema', exitCode: 1 })

      await expect(
        (service as any).assertSchemaCapability({
          source: 'mise',
          path: '/mock/bin/openclaw',
          version: '1.0.0',
          env: { PATH: '/mock/bin' }
        })
      ).rejects.toMatchObject({ kind: 'binary_incompatible' })
      expect(crossPlatformSpawnMock).toHaveBeenCalledWith(
        '/mock/bin/openclaw',
        ['config', 'schema'],
        expect.objectContaining({
          env: { PATH: '/mock/bin', OPENCLAW_CONFIG_PATH: '/mock/openclaw/openclaw.json' },
          stdio: ['ignore', 'pipe', 'pipe']
        })
      )
    })

    it('returns the runtime schema reported by the resolved OpenClaw binary', async () => {
      runOpenClawCommandSpy.mockRestore()
      schemaCapabilitySpy.mockRestore()
      const schema = createRuntimeConfigSchema()
      queueSpawnResult({ stdout: JSON.stringify(schema) })

      await expect(
        (service as any).assertSchemaCapability({
          source: 'mise',
          path: '/mock/bin/openclaw',
          version: '1.0.0',
          env: { PATH: '/mock/bin' }
        })
      ).resolves.toEqual(schema)
    })

    it('uses a dedicated bounded capture limit for the runtime schema', async () => {
      schemaCapabilitySpy.mockRestore()
      const schema = createRuntimeConfigSchema()
      runOpenClawCommandSpy.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(schema),
        stderr: '',
        outputTruncated: false
      })

      await expect(
        (service as any).assertSchemaCapability({
          path: '/mock/bin/openclaw',
          env: { PATH: '/mock/bin' }
        })
      ).resolves.toEqual(schema)
      expect(runOpenClawCommandSpy).toHaveBeenCalledWith(
        '/mock/bin/openclaw',
        ['config', 'schema'],
        {
          PATH: '/mock/bin',
          OPENCLAW_CONFIG_PATH: '/mock/openclaw/openclaw.json'
        },
        { stdoutLimitBytes: 32 * 1024 * 1024 }
      )
    })

    it('accepts a runtime schema larger than the diagnostic capture limit', async () => {
      runOpenClawCommandSpy.mockRestore()
      schemaCapabilitySpy.mockRestore()
      const schema = {
        ...createRuntimeConfigSchema(),
        description: 'x'.repeat(1024 * 1024)
      }
      queueSpawnResult({ stdout: JSON.stringify(schema) })

      await expect(
        (service as any).assertSchemaCapability({
          source: 'mise',
          path: '/mock/bin/openclaw',
          version: '1.0.0',
          env: { PATH: '/mock/bin' }
        })
      ).resolves.toEqual(schema)
    })

    it('redacts secrets and bounds diagnostic output', () => {
      const basicSecret = 'dXNlcjpwYXNz'
      const customSecret = 'credential with spaces'
      const diagnostic = [
        '{"apiKey":"sk-sensitive-value"}',
        'Authorization: Bearer bearer-sensitive-value',
        `Authorization: Basic ${basicSecret}`,
        `Authorization: Custom ${customSecret}`,
        'x'.repeat(2500)
      ].join('\n')

      const sanitized = (service as any).sanitizeDiagnostic(diagnostic)

      expect(sanitized).not.toContain('sk-sensitive-value')
      expect(sanitized).not.toContain('bearer-sensitive-value')
      expect(sanitized).not.toContain(basicSecret)
      expect(sanitized).not.toContain(customSecret)
      expect(sanitized).toContain('<redacted>')
      expect(sanitized.length).toBeLessThanOrEqual(2000)
    })

    it('runs config validation against the explicit candidate path and accepts a valid invalid report', async () => {
      validateConfigSpy.mockRestore()
      runOpenClawCommandSpy.mockResolvedValue({
        exitCode: 1,
        stdout: JSON.stringify({
          valid: false,
          path: '/mock/openclaw/openclaw.json.cherry-candidate-id',
          issues: [{ path: 'tools.web.fetch.ssrfPolicy', message: 'Unsupported field' }]
        }),
        stderr: 'ignored diagnostic',
        outputTruncated: false
      })
      const runtime = {
        source: 'mise',
        path: '/mock/bin/openclaw',
        version: '1.0.0',
        env: { PATH: '/mock/bin', MISE_DATA_DIR: '/mock/mise' }
      }

      await expect(
        (service as any).validateConfig(runtime, '/mock/openclaw/openclaw.json.cherry-candidate-id')
      ).resolves.toEqual({
        valid: false,
        path: '/mock/openclaw/openclaw.json.cherry-candidate-id',
        issues: [{ path: 'tools.web.fetch.ssrfPolicy', message: 'Unsupported field' }],
        warnings: []
      })
      expect(runOpenClawCommandSpy).toHaveBeenCalledWith('/mock/bin/openclaw', ['config', 'validate', '--json'], {
        PATH: '/mock/bin',
        MISE_DATA_DIR: '/mock/mise',
        OPENCLAW_CONFIG_PATH: '/mock/openclaw/openclaw.json.cherry-candidate-id'
      })
    })

    it('accepts a successful OpenClaw validation report without an issues field', () => {
      const path = '/mock/openclaw/openclaw.json.cherry-candidate-id'

      expect(
        (service as any).parseValidationResult({
          exitCode: 0,
          stdout: JSON.stringify({ valid: true, path, warnings: [] }),
          stderr: '',
          outputTruncated: false
        })
      ).toEqual({ valid: true, path, issues: [], warnings: [] })
    })

    it.each([
      { name: 'missing', reportPath: undefined },
      { name: 'different', reportPath: '/mock/openclaw/openclaw.json' }
    ])('rejects a successful validation report with a $name config path', async ({ reportPath }) => {
      validateConfigSpy.mockRestore()
      const candidatePath = '/mock/openclaw/openclaw.json.cherry-candidate-id'
      runOpenClawCommandSpy.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({
          valid: true,
          ...(reportPath === undefined ? {} : { path: reportPath }),
          warnings: []
        }),
        stderr: '',
        outputTruncated: false
      })

      await expect(
        (service as any).validateConfig({ path: '/mock/bin/openclaw', env: { PATH: '/mock/bin' } }, candidatePath)
      ).rejects.toMatchObject({ kind: 'binary_incompatible' })
    })

    it('accepts a validation report whose config path resolves to the requested path', async () => {
      validateConfigSpy.mockRestore()
      const candidatePath = '/mock/openclaw/openclaw.json.cherry-candidate-id'
      runOpenClawCommandSpy.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({
          valid: true,
          path: '/mock/openclaw/nested/../openclaw.json.cherry-candidate-id',
          warnings: []
        }),
        stderr: '',
        outputTruncated: false
      })

      await expect(
        (service as any).validateConfig({ path: '/mock/bin/openclaw', env: { PATH: '/mock/bin' } }, candidatePath)
      ).resolves.toMatchObject({ valid: true, path: '/mock/openclaw/nested/../openclaw.json.cherry-candidate-id' })
    })

    it('rejects an invalid validation report that omits the config path as binary incompatible', async () => {
      validateConfigSpy.mockRestore()
      runOpenClawCommandSpy.mockResolvedValueOnce({
        exitCode: 1,
        stdout: JSON.stringify({
          valid: false,
          issues: [{ path: 'models.providers.cherry-openai', message: 'Unsupported field' }]
        }),
        stderr: '',
        outputTruncated: false
      })

      await expect(
        (service as any).validateConfig(
          { path: '/mock/bin/openclaw', env: { PATH: '/mock/bin' } },
          '/mock/openclaw/openclaw.json.cherry-candidate-id'
        )
      ).rejects.toMatchObject({ kind: 'binary_incompatible' })
    })

    it.each([
      {
        name: 'valid false with missing issues',
        result: { exitCode: 1, stdout: JSON.stringify({ valid: false }), outputTruncated: false }
      },
      {
        name: 'valid false with no issues',
        result: { exitCode: 1, stdout: JSON.stringify({ valid: false, issues: [] }), outputTruncated: false }
      },
      {
        name: 'non-boolean valid field',
        result: { exitCode: 1, stdout: JSON.stringify({ valid: 'false', issues: [] }), outputTruncated: false }
      },
      {
        name: 'non-string issue path',
        result: {
          exitCode: 1,
          stdout: JSON.stringify({ valid: false, issues: [{ path: 1, message: 'bad' }] }),
          outputTruncated: false
        }
      },
      {
        name: 'non-array allowed values',
        result: {
          exitCode: 1,
          stdout: JSON.stringify({
            valid: false,
            issues: [{ path: 'tools.web.fetch', message: 'bad', allowedValues: 'none' }]
          }),
          outputTruncated: false
        }
      },
      {
        name: 'malformed warnings',
        result: {
          exitCode: 0,
          stdout: JSON.stringify({ valid: true, issues: [], warnings: [{ path: 'x', message: 1 }] }),
          outputTruncated: false
        }
      },
      {
        name: 'truncated output',
        result: { exitCode: 0, stdout: JSON.stringify({ valid: true, issues: [] }), outputTruncated: true }
      },
      {
        name: 'valid report with non-zero exit',
        result: { exitCode: 1, stdout: JSON.stringify({ valid: true, issues: [] }), outputTruncated: false }
      }
    ])('rejects $name as a preflight failure without exposing command output', ({ result }) => {
      let thrown: unknown
      try {
        ;(service as any).parseValidationResult({ ...result, stderr: 'apiKey: stderr-secret' })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toMatchObject({ kind: 'preflight_failed' })
      expect((thrown as Error).message).not.toContain(result.stdout)
      expect((thrown as Error).message).not.toContain('stderr-secret')
    })

    it('classifies a rejected Cherry-managed provider field as binary incompatibility', async () => {
      validateConfigSpy.mockResolvedValueOnce({
        valid: false,
        issues: [
          {
            path: 'models.providers.cherry-openai.models.0.contextWindow',
            message: 'Unsupported generated field'
          }
        ],
        warnings: []
      })

      await expect(
        (service as any).assertConfigValid(
          { source: 'mise', path: '/mock/bin/openclaw', env: { PATH: '/mock/bin' } },
          '/mock/openclaw/openclaw.json.cherry-candidate-id'
        )
      ).rejects.toMatchObject({
        kind: 'binary_incompatible',
        message: expect.stringContaining('incompatible with the generated configuration')
      })
    })

    it.each(['tools.web.fetch.ssrfPolicy', 'gateway.bind'])(
      'keeps rejected user-owned path %s classified as external config',
      async (issuePath) => {
        validateConfigSpy.mockResolvedValueOnce({
          valid: false,
          issues: [{ path: issuePath, message: 'Unsupported external field' }],
          warnings: []
        })

        await expect(
          (service as any).assertConfigValid(
            { source: 'mise', path: '/mock/bin/openclaw', env: { PATH: '/mock/bin' } },
            '/mock/openclaw/openclaw.json.cherry-candidate-id'
          )
        ).rejects.toMatchObject({
          kind: 'external_config_invalid',
          message: expect.stringContaining("outside Cherry Studio's managed provider section")
        })
      }
    )
  })

  describe('getDashboardUrl', () => {
    it('uses fragment token to keep dashboard auth client-side', () => {
      // @ts-expect-error -- accessing private field for testing
      service.gatewayAuthToken = 'a b+c'

      const url = service.getDashboardUrl()
      expect(url).toBe(`http://127.0.0.1:18790#token=${encodeURIComponent('a b+c')}`)
    })
  })

  describe('gateway health probe', () => {
    it('uses the canonical /healthz endpoint when /health serves HTML', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input)
        if (url.endsWith('/healthz')) {
          return new Response(JSON.stringify({ ok: true, status: 'live' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        }

        return new Response('<!doctype html><html></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' }
        })
      })

      await expect((service as any).checkGatewayHealthWithError()).resolves.toEqual({ status: 'healthy' })
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:18790/healthz',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    })

    it('reports an HTML health response without exposing a JSON parser error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('<!doctype html><html></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' }
        })
      )

      await expect((service as any).checkGatewayHealthWithError()).resolves.toEqual({
        status: 'unhealthy',
        error: 'Invalid JSON from /healthz (text/html)'
      })
    })
  })

  // ─── getStatus ───────────────────────────────────────────────

  describe('getStatus', () => {
    it('returns "starting" immediately without probing health', async () => {
      ;(service as any).gatewayStatus = 'starting'

      const result = await service.getStatus()

      expect(result).toEqual({ status: 'starting', port: 18790 })
      expect(checkHealthSpy).not.toHaveBeenCalled()
    })

    it('detects externally running gateway when stopped', async () => {
      ;(service as any).gatewayStatus = 'stopped'
      checkHealthSpy.mockResolvedValue({ status: 'healthy', gatewayPort: 18790 })

      const result = await service.getStatus()

      expect(result).toEqual({ status: 'running', port: 18790 })
    })

    it('detects externally running gateway when in error state', async () => {
      ;(service as any).gatewayStatus = 'error'
      checkHealthSpy.mockResolvedValue({ status: 'healthy', gatewayPort: 18790 })

      const result = await service.getStatus()

      expect(result).toEqual({ status: 'running', port: 18790 })
    })

    it('detects crashed gateway and transitions running → stopped', async () => {
      ;(service as any).gatewayStatus = 'running'
      checkHealthSpy.mockResolvedValue({ status: 'unhealthy', gatewayPort: 18790 })

      const result = await service.getStatus()

      expect(result).toEqual({ status: 'stopped', port: 18790 })
    })

    it('stays running when health probe is healthy', async () => {
      ;(service as any).gatewayStatus = 'running'
      checkHealthSpy.mockResolvedValue({ status: 'healthy', gatewayPort: 18790 })

      const result = await service.getStatus()

      expect(result).toEqual({ status: 'running', port: 18790 })
    })

    it('stays stopped when health probe is unhealthy', async () => {
      ;(service as any).gatewayStatus = 'stopped'
      checkHealthSpy.mockResolvedValue({ status: 'unhealthy', gatewayPort: 18790 })

      const result = await service.getStatus()

      expect(result).toEqual({ status: 'stopped', port: 18790 })
    })

    it('stays in error when health probe is unhealthy', async () => {
      ;(service as any).gatewayStatus = 'error'
      checkHealthSpy.mockResolvedValue({ status: 'unhealthy', gatewayPort: 18790 })

      const result = await service.getStatus()

      expect(result).toEqual({ status: 'error', port: 18790 })
    })

    it('discards a probe that resolves after a transition completed mid-flight', async () => {
      ;(service as any).gatewayStatus = 'stopped'
      let resolveProbe!: (value: { status: string; gatewayPort: number }) => void
      checkHealthSpy.mockImplementationOnce(() => new Promise((resolve) => (resolveProbe = resolve)))

      const pending = service.getStatus()
      ;(service as any).setGatewayStatus('starting') // startGateway began while the probe was pending
      resolveProbe({ status: 'healthy', gatewayPort: 18790 })

      // Returns the newer authoritative state instead of reviving 'running' from the stale probe.
      await expect(pending).resolves.toEqual({ status: 'starting', port: 18790 })
      expect(broadcastMock).not.toHaveBeenCalledWith('openclaw.status_changed', { status: 'running' })
    })
  })

  // ─── startGateway ────────────────────────────────────────────

  describe('startGateway', () => {
    it('resolves a system OpenClaw through BinaryManager availability', async () => {
      binaryManagerMock.getToolSnapshots.mockResolvedValue({
        openclaw: { name: 'openclaw', availability: { source: 'system', path: '/usr/local/bin/openclaw' } }
      })

      await expect((service as any).findOpenClawBinary()).resolves.toEqual({
        source: 'system',
        path: '/usr/local/bin/openclaw'
      })
      expect(binaryManagerMock.getToolSnapshots).toHaveBeenCalledWith(['openclaw'])
    })

    it('rejects concurrent startup calls', async () => {
      ;(service as any).gatewayStatus = 'starting'

      const result = await service.startGateway()

      expect(result).toEqual({ success: false, message: 'Gateway is already starting' })
    })

    it('rejects an invalid formal config before checking or stopping the gateway port', async () => {
      checkPortOpenSpy.mockResolvedValue(true)
      checkHealthSpy.mockResolvedValue({ status: 'healthy', gatewayPort: 18790 })
      const stopGatewaySpy = vi.spyOn(service, 'stopGateway').mockResolvedValue({ success: true })
      validateConfigSpy.mockResolvedValueOnce({
        valid: false,
        path: '/mock/openclaw/openclaw.json',
        issues: [{ path: 'tools.web.fetch.ssrfPolicy', message: 'Unrecognized key' }],
        warnings: []
      })

      const result = await service.startGateway()

      expect(result.success).toBe(false)
      expect(validateConfigSpy).toHaveBeenCalledWith(expect.any(Object), '/mock/openclaw/openclaw.json')
      expect(checkPortOpenSpy).not.toHaveBeenCalled()
      expect(stopGatewaySpy).not.toHaveBeenCalled()
      expect(startAndWaitSpy).not.toHaveBeenCalled()
    })

    it('runs formal config validation with the explicit OpenClaw config path', async () => {
      validateConfigSpy.mockRestore()
      runOpenClawCommandSpy.mockReset()
      runOpenClawCommandSpy.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({
          valid: true,
          path: '/mock/openclaw/openclaw.json',
          issues: [],
          warnings: []
        }),
        stderr: '',
        outputTruncated: false
      })
      checkPortOpenSpy.mockResolvedValue(false)
      startAndWaitSpy.mockResolvedValue(undefined)

      await expect(service.startGateway()).resolves.toEqual({ success: true })

      expect(runOpenClawCommandSpy).toHaveBeenCalledTimes(1)
      expect(runOpenClawCommandSpy.mock.calls[0][2]).toMatchObject({
        OPENCLAW_CONFIG_PATH: '/mock/openclaw/openclaw.json'
      })
    })

    it('spawns a system OpenClaw with the raw user environment and formal config path', async () => {
      const child = createSpawnChild()
      checkPortOpenSpy.mockResolvedValue(false)
      findBinarySpy.mockResolvedValue({ source: 'system', path: '/usr/local/bin/openclaw' })
      startAndWaitSpy.mockRestore()
      crossPlatformSpawnMock.mockReturnValue(child)
      vi.spyOn(service as any, 'checkGatewayHealthWithError').mockResolvedValue({
        status: 'healthy',
        gatewayPort: 18790
      })
      vi.useFakeTimers()

      const started = service.startGateway()
      await vi.advanceTimersByTimeAsync(1000)

      await expect(started).resolves.toEqual({ success: true })
      expect(crossPlatformSpawnMock).toHaveBeenCalledWith(
        '/usr/local/bin/openclaw',
        ['gateway', 'run', '--force'],
        expect.objectContaining({
          env: {
            PATH: '/usr/local/bin:/usr/bin',
            MISE_DATA_DIR: '/user/mise',
            OPENCLAW_CONFIG_PATH: '/mock/openclaw/openclaw.json',
            OPENCLAW_NO_AUTO_UPDATE: '1'
          }
        })
      )
      expect(child.unref).toHaveBeenCalledOnce()
    })

    it('spawns a managed OpenClaw with the refreshed environment and formal config path', async () => {
      const child = createSpawnChild()
      checkPortOpenSpy.mockResolvedValue(false)
      findBinarySpy.mockResolvedValue({ source: 'mise', path: '/mock/bin/openclaw', version: '1.0.0' })
      startAndWaitSpy.mockRestore()
      crossPlatformSpawnMock.mockReturnValue(child)
      vi.spyOn(service as any, 'checkGatewayHealthWithError').mockResolvedValue({
        status: 'healthy',
        gatewayPort: 18790
      })
      vi.useFakeTimers()

      const started = service.startGateway()
      await vi.advanceTimersByTimeAsync(1000)

      await expect(started).resolves.toEqual({ success: true })
      expect(crossPlatformSpawnMock).toHaveBeenCalledWith(
        '/mock/bin/openclaw',
        ['gateway', 'run', '--force'],
        expect.objectContaining({
          env: {
            PATH: '/mock/bin:/usr/bin',
            MISE_DATA_DIR: '/mock/mise',
            OPENCLAW_CONFIG_PATH: '/mock/openclaw/openclaw.json',
            OPENCLAW_NO_AUTO_UPDATE: '1'
          }
        })
      )
      expect(child.unref).toHaveBeenCalledOnce()
    })

    it('launches a system OpenClaw .cmd through the process runner on Windows', async () => {
      platformMock.isWin = true
      const child = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        unref: vi.fn()
      }
      crossPlatformSpawnMock.mockReturnValue(child)
      vi.spyOn(service as any, 'checkGatewayHealthWithError').mockResolvedValue({
        status: 'healthy',
        gatewayPort: 18790
      })
      vi.useFakeTimers()

      const started = (service as any).startAndWaitForGateway('C:\\Users\\V\\AppData\\Roaming\\npm\\openclaw.cmd', {
        Path: 'C:\\Windows\\System32'
      })
      await vi.advanceTimersByTimeAsync(1000)

      await expect(started).resolves.toBeUndefined()
      expect(crossPlatformSpawnMock).toHaveBeenCalledWith(
        'C:\\Users\\V\\AppData\\Roaming\\npm\\openclaw.cmd',
        ['gateway', 'run', '--force'],
        expect.objectContaining({
          detached: false,
          env: {
            Path: 'C:\\Windows\\System32',
            OPENCLAW_CONFIG_PATH: '/mock/openclaw/openclaw.json',
            OPENCLAW_NO_AUTO_UPDATE: '1'
          },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true
        })
      )
      expect(child.unref).toHaveBeenCalledOnce()
    })

    it('stops stale gateway and restarts when port is in use by our gateway', async () => {
      // First call: port occupied; after stop: port free
      checkPortOpenSpy.mockResolvedValueOnce(true).mockResolvedValue(false)
      checkHealthSpy.mockResolvedValue({ status: 'healthy', gatewayPort: 18790 }) // startGateway detects our gateway
      findBinarySpy.mockResolvedValue({ source: 'mise', path: '/mock/bin/openclaw', version: '1.0.0' })
      startAndWaitSpy.mockResolvedValue(undefined)

      const result = await service.startGateway()

      expect(result).toEqual({ success: true })
      expect((service as any).gatewayStatus).toBe('running')
    })

    it('fails when port is in use by another application', async () => {
      checkPortOpenSpy.mockResolvedValue(true)
      checkHealthSpy.mockResolvedValue({ status: 'unhealthy', gatewayPort: 18790 })

      const result = await service.startGateway()

      expect(result.success).toBe(false)
      expect('message' in result && result.message).toContain('already in use')
    })

    it('fails when binary is not found', async () => {
      checkPortOpenSpy.mockResolvedValue(false)
      findBinarySpy.mockResolvedValue(null)

      const result = await service.startGateway()

      expect(result).toEqual({
        success: false,
        message: 'OpenClaw binary not found. Please install OpenClaw first.'
      })
    })

    it('transitions to running on successful start', async () => {
      checkPortOpenSpy.mockResolvedValue(false)
      findBinarySpy.mockResolvedValue({ source: 'mise', path: '/mock/bin/openclaw', version: '1.0.0' })
      startAndWaitSpy.mockResolvedValue(undefined)

      const result = await service.startGateway()

      expect(result).toEqual({ success: true })
      expect((service as any).gatewayStatus).toBe('running')
    })

    it('transitions to error when start fails', async () => {
      checkPortOpenSpy.mockResolvedValue(false)
      findBinarySpy.mockResolvedValue({ source: 'mise', path: '/mock/bin/openclaw', version: '1.0.0' })
      startAndWaitSpy.mockRejectedValue(new Error('Gateway timeout'))

      const result = await service.startGateway()

      expect(result).toEqual({ success: false, message: 'Gateway timeout' })
      expect((service as any).gatewayStatus).toBe('error')
    })

    it('sets status to starting during startup', async () => {
      checkPortOpenSpy.mockResolvedValue(false)
      findBinarySpy.mockResolvedValue({ source: 'mise', path: '/mock/bin/openclaw', version: '1.0.0' })

      let statusDuringStart: string | undefined
      startAndWaitSpy.mockImplementation(async () => {
        statusDuringStart = (service as any).gatewayStatus
      })

      await service.startGateway()

      expect(statusDuringStart).toBe('starting')
    })

    it('uses custom port when provided', async () => {
      checkPortOpenSpy.mockResolvedValue(false)
      findBinarySpy.mockResolvedValue({ source: 'mise', path: '/mock/bin/openclaw', version: '1.0.0' })
      startAndWaitSpy.mockResolvedValue(undefined)

      await service.startGateway(9999)

      expect((service as any).gatewayPort).toBe(9999)
    })
  })

  // ─── stopGateway ─────────────────────────────────────────────

  describe('stopGateway', () => {
    it('transitions to stopped on successful stop', async () => {
      ;(service as any).gatewayStatus = 'running'
      checkPortOpenSpy.mockResolvedValue(false)

      const result = await service.stopGateway()

      expect(result).toEqual({ success: true })
      expect((service as any).gatewayStatus).toBe('stopped')
      expect(checkHealthSpy).not.toHaveBeenCalled()
    })

    it('transitions to error when gateway fails to stop', async () => {
      vi.useFakeTimers()
      ;(service as any).gatewayStatus = 'running'
      checkPortOpenSpy.mockResolvedValue(true)

      const resultPromise = service.stopGateway()
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.success).toBe(false)
      expect((service as any).gatewayStatus).toBe('error')
      expect(checkPortOpenSpy).toHaveBeenCalledTimes(3)
      expect(checkHealthSpy).not.toHaveBeenCalled()
    })
  })

  // ─── status broadcasts + periodic probe ─────────────────────

  describe('gateway status broadcasts', () => {
    const statusPayloads = () =>
      broadcastMock.mock.calls.filter((call) => call[0] === 'openclaw.status_changed').map((call) => call[1])

    it('broadcasts starting then running on a successful start', async () => {
      checkPortOpenSpy.mockResolvedValue(false)
      findBinarySpy.mockResolvedValue({ source: 'mise', path: '/mock/bin/openclaw', version: '1.0.0' })
      startAndWaitSpy.mockResolvedValue(undefined)

      await expect(service.startGateway()).resolves.toEqual({ success: true })

      expect(statusPayloads()).toEqual([{ status: 'starting' }, { status: 'running' }])
    })

    it('broadcasts error when the start fails', async () => {
      checkPortOpenSpy.mockResolvedValue(false)
      findBinarySpy.mockResolvedValue({ source: 'mise', path: '/mock/bin/openclaw', version: '1.0.0' })
      startAndWaitSpy.mockRejectedValue(new Error('Gateway timeout'))

      await expect(service.startGateway()).resolves.toMatchObject({ success: false })

      expect(statusPayloads().at(-1)).toEqual({ status: 'error' })
    })

    it('announces stopped when a stop completes', async () => {
      ;(service as any).gatewayStatus = 'running'
      checkPortOpenSpy.mockResolvedValue(false)

      await expect(service.stopGateway()).resolves.toEqual({ success: true })

      expect(statusPayloads().at(-1)).toEqual({ status: 'stopped' })
    })

    it('confirms stopped on a no-op stop so a stale renderer is corrected', async () => {
      ;(service as any).gatewayStatus = 'stopped'
      checkPortOpenSpy.mockResolvedValue(false)
      broadcastMock.mockClear()

      await expect(service.stopGateway()).resolves.toEqual({ success: true })

      // No transition happened, but the request still announces the terminal state.
      expect(broadcastMock).toHaveBeenCalledWith('openclaw.status_changed', { status: 'stopped' })
    })

    it('keeps the current custom port when startGateway is called without one', async () => {
      ;(service as any).gatewayPort = 18888
      checkPortOpenSpy.mockResolvedValue(false)
      findBinarySpy.mockResolvedValue({ source: 'mise', path: '/mock/bin/openclaw', version: '1.0.0' })
      startAndWaitSpy.mockResolvedValue(undefined)

      await expect(service.startGateway()).resolves.toEqual({ success: true })

      expect((service as any).gatewayPort).toBe(18888)
    })
  })

  describe('gateway port preference sync', () => {
    it('adopts the persisted custom gateway port at readiness', () => {
      vi.mocked(application.get).mockImplementationOnce(
        () =>
          ({
            get: (key: string) => (key === 'feature.openclaw.gateway_port' ? 18888 : undefined)
          }) as never
      )

      ;(service as any).syncGatewayPortFromPreference()

      expect((service as any).gatewayPort).toBe(18888)
    })

    it('keeps the default port when the preference value is not a positive integer', () => {
      vi.mocked(application.get).mockImplementationOnce(() => ({ get: () => 'en-US' }) as never)

      ;(service as any).syncGatewayPortFromPreference()

      expect((service as any).gatewayPort).toBe(18790)
    })

    it('keeps the current port when the preference value exceeds the valid range', () => {
      ;(service as any).gatewayPort = 18888
      vi.mocked(application.get).mockImplementationOnce(() => ({ get: () => 70000 }) as never)

      ;(service as any).syncGatewayPortFromPreference()

      expect((service as any).gatewayPort).toBe(18888)
    })

    it('adopts a changed custom port while the gateway is idle', () => {
      ;(service as any).gatewayStatus = 'stopped'
      vi.mocked(application.get).mockImplementationOnce(
        () => ({ get: (key: string) => (key === 'feature.openclaw.gateway_port' ? 19999 : undefined) }) as never
      )

      ;(service as any).onGatewayPortPreferenceChanged()

      expect((service as any).gatewayPort).toBe(19999)
    })

    it('keeps the running gateway port when the preference changes mid-run', () => {
      ;(service as any).gatewayStatus = 'running'
      ;(service as any).gatewayPort = 18888
      // A valid changed preference: without the running guard this would be adopted.
      vi.mocked(application.get).mockImplementationOnce(
        () => ({ get: (key: string) => (key === 'feature.openclaw.gateway_port' ? 19999 : undefined) }) as never
      )

      ;(service as any).onGatewayPortPreferenceChanged()

      expect((service as any).gatewayPort).toBe(18888)
    })

    it('adopts a port change deferred during a run once the gateway becomes idle', () => {
      ;(service as any).gatewayStatus = 'running'
      ;(service as any).gatewayPort = 18888
      // Preference changed to 19999 mid-run (deferred), then the gateway stopped.
      vi.mocked(application.get).mockImplementationOnce(
        () => ({ get: (key: string) => (key === 'feature.openclaw.gateway_port' ? 19999 : undefined) }) as never
      )

      ;(service as any).setGatewayStatus('stopped')

      expect((service as any).gatewayPort).toBe(19999)
    })
  })

  describe('probeGatewayTick (liveness of a running gateway)', () => {
    it('marks a dead gateway stopped when the probe goes unhealthy', async () => {
      ;(service as any).gatewayStatus = 'running'
      checkHealthSpy.mockResolvedValue({ status: 'unhealthy', gatewayPort: 18790 })

      await (service as any).probeGatewayTick()

      expect((service as any).gatewayStatus).toBe('stopped')
      expect(broadcastMock).toHaveBeenCalledWith('openclaw.status_changed', { status: 'stopped' })
    })

    // The tick only watches what this service believes it owns. Discovering a gateway
    // started outside the app is getStatus()'s read-time job, so an idle service does
    // no background IO at all — the interval must not probe on behalf of every user.
    it.each(['stopped', 'error', 'starting'] as const)('does no IO while %s', async (status) => {
      ;(service as any).gatewayStatus = status

      await (service as any).probeGatewayTick()

      expect(checkHealthSpy).not.toHaveBeenCalled()
      expect(broadcastMock).not.toHaveBeenCalled()
    })

    it('broadcasts nothing while the gateway stays healthy', async () => {
      ;(service as any).gatewayStatus = 'running'
      checkHealthSpy.mockResolvedValue({ status: 'healthy', gatewayPort: 18790 })

      await (service as any).probeGatewayTick()

      expect(broadcastMock).not.toHaveBeenCalled()
    })

    it('swallows a probe failure instead of throwing', async () => {
      ;(service as any).gatewayStatus = 'running'
      checkHealthSpy.mockRejectedValue(new Error('ECONNREFUSED'))

      await expect((service as any).probeGatewayTick()).resolves.toBeUndefined()
    })

    // A probe result is only valid for the transition/port generation it started against.
    it('discards a healthy probe that resolves after a stop completed mid-flight', async () => {
      ;(service as any).gatewayStatus = 'running'
      let resolveProbe!: (value: { status: string; gatewayPort: number }) => void
      checkHealthSpy.mockImplementationOnce(() => new Promise((resolve) => (resolveProbe = resolve)))

      const tick = (service as any).probeGatewayTick()
      ;(service as any).setGatewayStatus('stopped') // stopGateway completed while the probe was pending
      resolveProbe({ status: 'healthy', gatewayPort: 18790 })
      await tick

      expect((service as any).gatewayStatus).toBe('stopped')
      expect(broadcastMock).not.toHaveBeenCalledWith('openclaw.status_changed', { status: 'running' })
    })

    it('discards an unhealthy probe when the gateway port changed mid-flight', async () => {
      ;(service as any).gatewayStatus = 'running'
      let resolveProbe!: (value: { status: string; gatewayPort: number }) => void
      checkHealthSpy.mockImplementationOnce(() => new Promise((resolve) => (resolveProbe = resolve)))

      const tick = (service as any).probeGatewayTick()
      ;(service as any).gatewayPort = 18888 // syncConfig-style port change during the probe
      resolveProbe({ status: 'unhealthy', gatewayPort: 18790 }) // result belongs to the old port
      await tick

      expect((service as any).gatewayStatus).toBe('running')
      expect((service as any).gatewayPort).toBe(18888)
      expect(broadcastMock).not.toHaveBeenCalledWith('openclaw.status_changed', { status: 'stopped' })
    })

    it('discards an unhealthy probe after a restart returned to the same status and port', async () => {
      ;(service as any).gatewayStatus = 'running'
      let resolveProbe!: (value: { status: string; gatewayPort: number }) => void
      checkHealthSpy.mockImplementationOnce(() => new Promise((resolve) => (resolveProbe = resolve)))

      const tick = (service as any).probeGatewayTick()
      // A full restart completes inside the probe window: same terminal values, newer generation.
      ;(service as any).setGatewayStatus('stopped')
      ;(service as any).setGatewayStatus('running')
      resolveProbe({ status: 'unhealthy', gatewayPort: 18790 }) // stale result from the dying old gateway
      await tick

      expect((service as any).gatewayStatus).toBe('running')
      // Exactly the two simulated transitions — the stale probe contributed nothing.
      const payloads = broadcastMock.mock.calls.filter((c) => c[0] === 'openclaw.status_changed').map((c) => c[1])
      expect(payloads).toEqual([{ status: 'stopped' }, { status: 'running' }])
    })
  })

  // ─── syncConfig ─────────────────────────────────────────────

  describe('syncConfig', () => {
    // Regression: syncProviderConfig writes config.gateway.port from this.gatewayPort, but sync
    // runs before startGateway(port) updates it. A caller-supplied port must be applied first, or
    // a custom port is written as the stale default (18790) and the gateway binds the wrong port.
    it('applies the caller port before syncProviderConfig writes the config', async () => {
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(createProvider())
      const model = createModel()
      vi.mocked(modelService.getByKey).mockResolvedValue(model)
      vi.mocked(modelService.list).mockResolvedValue([model])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([{ id: 'key-1', key: 'sk-test', isEnabled: true }])

      let portAtWrite: number | undefined
      vi.spyOn(service, 'syncProviderConfig').mockImplementation(async () => {
        portAtWrite = (service as any).gatewayPort
        return { success: true }
      })

      await service.syncConfig('openai::gpt-4o', 20000)

      expect(portAtWrite).toBe(20000)
      expect((service as any).gatewayPort).toBe(20000)
    })

    it('leaves the current gateway port unchanged when no port is supplied', async () => {
      ;(service as any).gatewayPort = 12345
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(createProvider())
      const model = createModel()
      vi.mocked(modelService.getByKey).mockResolvedValue(model)
      vi.mocked(modelService.list).mockResolvedValue([model])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([{ id: 'key-1', key: 'sk-test', isEnabled: true }])
      vi.spyOn(service, 'syncProviderConfig').mockResolvedValue({ success: true })

      await service.syncConfig('openai::gpt-4o')

      expect((service as any).gatewayPort).toBe(12345)
    })

    it('resolves a unique model id before syncing OpenClaw config', async () => {
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(createProvider())
      const model = createModel({
        contextWindow: 128000,
        maxOutputTokens: 16384,
        capabilities: [MODEL_CAPABILITY.REASONING],
        inputModalities: ['text', 'image'],
        pricing: {
          input: { perMillionTokens: 2 },
          output: { perMillionTokens: 8 },
          cacheRead: { perMillionTokens: 0.2 },
          cacheWrite: { perMillionTokens: 2.5 }
        }
      })
      vi.mocked(modelService.getByKey).mockResolvedValue(model)
      vi.mocked(modelService.list).mockResolvedValue([model])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([{ id: 'key-1', key: 'sk-test', isEnabled: true }])
      const syncProviderConfigSpy = vi.spyOn(service, 'syncProviderConfig').mockResolvedValue({ success: true })

      const result = await service.syncConfig('openai::gpt-4o')

      expect(result).toEqual({ success: true })
      expect(syncProviderConfigSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'openai',
          apiKey: 'sk-test',
          apiHost: 'https://api.openai.com',
          anthropicApiHost: undefined,
          models: [
            expect.objectContaining({
              id: 'gpt-4o',
              endpoint_type: 'openai',
              contextWindow: 128000,
              maxTokens: 16384,
              reasoning: true,
              input: ['text', 'image'],
              cost: { input: 2, output: 8, cacheRead: 0.2, cacheWrite: 2.5 }
            })
          ]
        }),
        expect.objectContaining({ id: 'gpt-4o', endpoint_type: 'openai' })
      )
      expect(modelService.list).toHaveBeenCalledWith({ providerId: 'openai', enabled: true })
    })

    it('does not route a mixed provider OpenAI model through the Anthropic endpoint', async () => {
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(
        createProvider({
          id: 'new-api',
          name: 'New API',
          endpointConfigs: {
            [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://new-api.example.com/openai' },
            [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://new-api.example.com/anthropic' }
          }
        })
      )
      const model = createModel({ id: 'new-api::gpt-4o', providerId: 'new-api' })
      const anthropicModel = createModel({
        id: 'new-api::claude-sonnet-4',
        providerId: 'new-api',
        apiModelId: 'claude-sonnet-4',
        name: 'Claude Sonnet 4',
        endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
      })
      vi.mocked(modelService.getByKey).mockResolvedValue(model)
      vi.mocked(modelService.list).mockResolvedValue([model, anthropicModel])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([{ id: 'key-1', key: 'sk-test', isEnabled: true }])
      const syncProviderConfigSpy = vi.spyOn(service, 'syncProviderConfig').mockResolvedValue({ success: true })

      const result = await service.syncConfig('new-api::gpt-4o')

      expect(result).toEqual({ success: true })
      expect(syncProviderConfigSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          apiHost: 'https://new-api.example.com/openai',
          anthropicApiHost: undefined,
          models: [expect.objectContaining({ id: 'gpt-4o', endpoint_type: 'openai' })]
        }),
        expect.objectContaining({ endpoint_type: 'openai' })
      )
    })

    it('excludes hidden models from the synced model list', async () => {
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(createProvider())
      const visibleModel = createModel()
      const hiddenModel = createModel({ id: 'openai::hidden-model', apiModelId: 'hidden-model', isHidden: true })
      vi.mocked(modelService.getByKey).mockResolvedValue(visibleModel)
      vi.mocked(modelService.list).mockResolvedValue([visibleModel, hiddenModel])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([{ id: 'key-1', key: 'sk-test', isEnabled: true }])
      const syncProviderConfigSpy = vi.spyOn(service, 'syncProviderConfig').mockResolvedValue({ success: true })

      const result = await service.syncConfig('openai::gpt-4o')

      expect(result).toEqual({ success: true })
      expect(syncProviderConfigSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          models: [expect.objectContaining({ id: 'gpt-4o' })]
        }),
        expect.anything()
      )
    })

    it('excludes non-chat models from the synced model list', async () => {
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(createProvider())
      const chatModel = createModel()
      const embeddingModel = createModel({
        id: 'openai::text-embedding-3-large',
        apiModelId: 'text-embedding-3-large',
        name: 'Text Embedding 3 Large',
        capabilities: [MODEL_CAPABILITY.EMBEDDING]
      })
      vi.mocked(modelService.getByKey).mockResolvedValue(chatModel)
      vi.mocked(modelService.list).mockResolvedValue([chatModel, embeddingModel])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([{ id: 'key-1', key: 'sk-test', isEnabled: true }])
      const syncProviderConfigSpy = vi.spyOn(service, 'syncProviderConfig').mockResolvedValue({ success: true })

      const result = await service.syncConfig('openai::gpt-4o')

      expect(result).toEqual({ success: true })
      expect(syncProviderConfigSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          models: [expect.objectContaining({ id: 'gpt-4o' })]
        }),
        expect.anything()
      )
    })

    it('returns an error for invalid model selections', async () => {
      // Bypasses the compile-time UniqueModelId contract on purpose: the service's
      // runtime safeParse is the boundary defense for non-IPC callers.
      const result = await service.syncConfig('invalid-model-id' as UniqueModelId)

      expect(result).toEqual({ success: false, message: 'Invalid OpenClaw model selection' })
    })

    it('returns an error when the selected endpoint has no API host', async () => {
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(
        createProvider({
          endpointConfigs: {}
        })
      )
      const model = createModel()
      vi.mocked(modelService.getByKey).mockResolvedValue(model)
      vi.mocked(modelService.list).mockResolvedValue([model])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([{ id: 'key-1', key: 'sk-test', isEnabled: true }])

      const result = await service.syncConfig('openai::gpt-4o')

      expect(result).toEqual({
        success: false,
        message: `Provider openai has no API host configured for ${ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS}`
      })
    })

    it('does not borrow an API host from another endpoint type', async () => {
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(
        createProvider({
          endpointConfigs: {
            [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.openai.com' }
          }
        })
      )
      const model = createModel({
        endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
      })
      vi.mocked(modelService.getByKey).mockResolvedValue(model)
      vi.mocked(modelService.list).mockResolvedValue([model])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([{ id: 'key-1', key: 'sk-test', isEnabled: true }])
      const syncProviderConfigSpy = vi.spyOn(service, 'syncProviderConfig').mockResolvedValue({ success: true })

      const result = await service.syncConfig('openai::gpt-4o')

      expect(result).toEqual({
        success: false,
        message: `Provider openai has no API host configured for ${ENDPOINT_TYPE.ANTHROPIC_MESSAGES}`
      })
      expect(syncProviderConfigSpy).not.toHaveBeenCalled()
    })

    it('returns an error when an API-key provider has no enabled API key', async () => {
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(createProvider())
      const model = createModel()
      vi.mocked(modelService.getByKey).mockResolvedValue(model)
      vi.mocked(modelService.list).mockResolvedValue([model])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([])

      const result = await service.syncConfig('openai::gpt-4o')

      expect(result).toEqual({ success: false, message: 'Provider openai has no enabled API key configured' })
    })

    it('returns an error when the selected OpenClaw model is non-chat', async () => {
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(createProvider())
      const embeddingModel = createModel({
        id: 'openai::text-embedding-3-large',
        apiModelId: 'text-embedding-3-large',
        name: 'Text Embedding 3 Large',
        capabilities: [MODEL_CAPABILITY.EMBEDDING]
      })
      vi.mocked(modelService.getByKey).mockResolvedValue(embeddingModel)
      vi.mocked(modelService.list).mockResolvedValue([embeddingModel])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([{ id: 'key-1', key: 'sk-test', isEnabled: true }])
      const syncProviderConfigSpy = vi.spyOn(service, 'syncProviderConfig').mockResolvedValue({ success: true })

      const result = await service.syncConfig('openai::text-embedding-3-large')

      expect(result).toEqual({ success: false, message: 'Selected OpenClaw model must support chat' })
      expect(syncProviderConfigSpy).not.toHaveBeenCalled()
    })

    it('allows keyless GPUStack providers during sync', async () => {
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(
        createProvider({
          id: 'gpustack',
          name: 'GPUStack',
          presetProviderId: 'gpustack',
          endpointConfigs: {
            [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'http://127.0.0.1:8080/v1' }
          }
        })
      )
      const model = createModel({
        id: 'gpustack::qwen3',
        providerId: 'gpustack',
        apiModelId: 'qwen3',
        name: 'Qwen3'
      })
      vi.mocked(modelService.getByKey).mockResolvedValue(model)
      vi.mocked(modelService.list).mockResolvedValue([model])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([])
      const syncProviderConfigSpy = vi.spyOn(service, 'syncProviderConfig').mockResolvedValue({ success: true })

      const result = await service.syncConfig('gpustack::qwen3')

      expect(result).toEqual({ success: true })
      expect(syncProviderConfigSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'gpustack',
          apiKey: 'gpustack',
          apiHost: 'http://127.0.0.1:8080/v1'
        }),
        expect.objectContaining({ id: 'qwen3' })
      )
    })

    it('maps Anthropic endpoint models to Anthropic OpenClaw provider config', async () => {
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(
        createProvider({
          id: 'new-api',
          name: 'New API',
          endpointConfigs: {
            [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://new-api.example.com/anthropic' }
          }
        })
      )
      const model = createModel({
        id: 'new-api::claude-sonnet-4',
        providerId: 'new-api',
        apiModelId: 'claude-sonnet-4',
        endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
      })
      vi.mocked(modelService.getByKey).mockResolvedValue(model)
      vi.mocked(modelService.list).mockResolvedValue([model])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([{ id: 'key-1', key: 'sk-test', isEnabled: true }])
      const syncProviderConfigSpy = vi.spyOn(service, 'syncProviderConfig').mockResolvedValue({ success: true })

      const result = await service.syncConfig('new-api::claude-sonnet-4')

      expect(result).toEqual({ success: true })
      expect(syncProviderConfigSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'anthropic',
          apiHost: 'https://new-api.example.com/anthropic',
          anthropicApiHost: 'https://new-api.example.com/anthropic'
        }),
        expect.objectContaining({ id: 'claude-sonnet-4', endpoint_type: 'anthropic' })
      )
    })

    it('maps OpenAI Responses endpoint models through provider and model config', async () => {
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(
        createProvider({
          endpointConfigs: {
            [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://api.openai.com' }
          },
          defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES
        })
      )
      const model = createModel({
        endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES]
      })
      vi.mocked(modelService.getByKey).mockResolvedValue(model)
      vi.mocked(modelService.list).mockResolvedValue([model])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([{ id: 'key-1', key: 'sk-test', isEnabled: true }])
      const syncProviderConfigSpy = vi.spyOn(service, 'syncProviderConfig').mockResolvedValue({ success: true })

      const result = await service.syncConfig('openai::gpt-4o')

      expect(result).toEqual({ success: true })
      expect(syncProviderConfigSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'openai-response',
          apiHost: 'https://api.openai.com'
        }),
        expect.objectContaining({ endpoint_type: 'openai-response' })
      )
    })

    it('determines OpenAI Responses API type from model endpoint type', () => {
      const apiType = (service as any).determineApiType(
        {
          id: 'openai',
          type: 'openai',
          apiHost: 'https://api.openai.com'
        },
        { id: 'gpt-4o', provider: 'openai', endpoint_type: 'openai-response' }
      )

      expect(apiType).toBe('openai-responses')
    })

    it('returns an error for providers OpenClaw sync cannot adapt yet', async () => {
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(
        createProvider({
          id: 'vertexai',
          presetProviderId: 'vertexai',
          name: 'Vertex AI',
          endpointConfigs: {
            [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { baseUrl: 'https://generativelanguage.googleapis.com' }
          },
          defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
        })
      )
      const model = createModel({
        id: 'vertexai::gemini-2.5-pro',
        providerId: 'vertexai',
        apiModelId: 'gemini-2.5-pro',
        endpointTypes: [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]
      })
      vi.mocked(modelService.getByKey).mockResolvedValue(model)
      vi.mocked(modelService.list).mockResolvedValue([model])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([{ id: 'key-1', key: 'sk-test', isEnabled: true }])

      const result = await service.syncConfig('vertexai::gemini-2.5-pro')

      expect(result).toEqual({ success: false, message: 'OpenClaw sync does not support Vertex AI providers yet' })
    })
  })

  // ─── syncProviderConfig existing-config handling ─────────────

  describe('syncProviderConfig existing-config handling', () => {
    let configDir: string

    // Minimal legacy-shaped provider/model — syncProviderConfig still takes the
    // migration legacyTypes shapes, not the Data* ones used by syncConfig.
    const legacyProvider = {
      id: 'openai',
      type: 'openai',
      name: 'OpenAI',
      apiKey: 'sk-test',
      apiHost: 'https://api.openai.com',
      models: [{ id: 'gpt-4o', name: 'GPT-4o' }]
    } as any
    const legacyModel = { id: 'gpt-4o', provider: 'openai', name: 'GPT-4o' } as any

    beforeEach(() => {
      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-config-'))
      vi.mocked(application.getPath).mockReturnValue(configDir)
    })

    afterEach(() => {
      fs.rmSync(configDir, { recursive: true, force: true })
    })

    it('aborts the sync when the existing config is not valid JSON', async () => {
      const configPath = path.join(configDir, 'openclaw.json')
      fs.writeFileSync(configPath, '{ not json', 'utf-8')

      const result = await service.syncProviderConfig(legacyProvider, legacyModel)

      expect(result.success).toBe(false)
      expect('message' in result && result.message).toMatch(/not valid JSON/)
      // The unparseable file must survive so the user can repair it by hand.
      expect(fs.readFileSync(configPath, 'utf-8')).toBe('{ not json')
    })

    it('writes a fresh config when none exists yet', async () => {
      const result = await service.syncProviderConfig(legacyProvider, legacyModel)

      expect(result).toEqual({ success: true })
      const written = JSON.parse(fs.readFileSync(path.join(configDir, 'openclaw.json'), 'utf-8'))
      expect(written.models.providers['cherry-openai']).toMatchObject({ apiKey: 'sk-test' })
      expect(written.agents.defaults.model.primary).toBe('cherry-openai/gpt-4o')
    })

    it('disables the OpenClaw update hint so its banner cannot swap the managed binary', async () => {
      await service.syncProviderConfig(legacyProvider, legacyModel)

      const written = JSON.parse(fs.readFileSync(path.join(configDir, 'openclaw.json'), 'utf-8'))
      expect(written.update.checkOnStart).toBe(false)
    })

    it('keeps an explicit checkOnStart choice instead of forcing the update hint off', async () => {
      fs.writeFileSync(path.join(configDir, 'openclaw.json'), JSON.stringify({ update: { checkOnStart: true } }))

      await service.syncProviderConfig(legacyProvider, legacyModel)

      const written = JSON.parse(fs.readFileSync(path.join(configDir, 'openclaw.json'), 'utf-8'))
      expect(written.update.checkOnStart).toBe(true)
    })

    it('removes stale Cherry providers while preserving supported hand edits on the selected provider', async () => {
      fs.writeFileSync(
        path.join(configDir, 'openclaw.json'),
        JSON.stringify({
          models: {
            mode: 'merge',
            providers: {
              'cherry-openai': {
                baseUrl: 'https://manual.example.com',
                apiKey: 'manual-key',
                api: 'anthropic-messages',
                headers: { 'User-Agent': 'OpenClaw', 'X-Manual': 'keep' },
                models: [
                  {
                    id: 'gpt-4o',
                    name: 'Old',
                    contextWindow: 200000,
                    maxTokens: 32000,
                    customField: 'remove'
                  }
                ]
              },
              'cherry-minimax': {
                models: [{ id: 'MiniMax-M2', name: 'MiniMax M2', maxTokens: 4096 }]
              },
              external: {
                baseUrl: 'https://external.example.com',
                apiKey: 'external-key',
                api: 'openai-completions',
                models: [{ id: 'external-model', name: 'External Model' }]
              }
            }
          },
          tools: {
            web: {
              search: { enabled: true },
              fetch: { ssrfPolicy: { allowPrivateNetwork: false } }
            }
          }
        })
      )
      const provider = {
        ...legacyProvider,
        headers: { 'User-Agent': 'Cherry Studio', 'X-Synced': 'synced' },
        models: [
          {
            id: 'gpt-4o',
            name: 'GPT-4o',
            contextWindow: 128000,
            maxTokens: 16384,
            reasoning: true,
            input: ['text', 'image'],
            cost: { input: 2, output: 8 }
          }
        ]
      }

      await service.syncProviderConfig(provider, legacyModel)

      const written = JSON.parse(fs.readFileSync(path.join(configDir, 'openclaw.json'), 'utf-8'))
      expect(Object.keys(written.models.providers)).toEqual(['external', 'cherry-openai'])
      expect(written.models.providers.external).toEqual({
        baseUrl: 'https://external.example.com',
        apiKey: 'external-key',
        api: 'openai-completions',
        models: [{ id: 'external-model', name: 'External Model' }]
      })
      expect(written.models.providers['cherry-openai']).toEqual({
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        api: 'openai-completions',
        headers: { 'User-Agent': 'OpenClaw', 'X-Synced': 'synced', 'X-Manual': 'keep' },
        models: [
          {
            id: 'gpt-4o',
            name: 'GPT-4o',
            contextWindow: 200000,
            maxTokens: 32000,
            reasoning: true,
            input: ['text', 'image'],
            cost: { input: 2, output: 8 }
          }
        ]
      })
      expect(written.tools).toEqual({
        web: {
          search: { enabled: true },
          fetch: { ssrfPolicy: { allowPrivateNetwork: false } }
        }
      })
    })

    it('recursively removes unsupported nested managed fields while preserving schema-supported values', async () => {
      schemaCapabilitySpy.mockResolvedValueOnce({
        type: 'object',
        properties: {
          models: {
            type: 'object',
            properties: {
              providers: {
                type: 'object',
                additionalProperties: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    baseUrl: { type: 'string' },
                    apiKey: { type: 'string' },
                    api: { type: 'string' },
                    headers: { type: 'object', additionalProperties: true },
                    request: {
                      allOf: [
                        {},
                        {
                          type: 'object',
                          additionalProperties: false,
                          properties: {
                            allowPrivateNetwork: { type: 'boolean' },
                            auth: {
                              anyOf: [
                                {
                                  type: 'object',
                                  additionalProperties: false,
                                  properties: { mode: { const: 'provider-default' } }
                                },
                                {
                                  type: 'object',
                                  additionalProperties: false,
                                  properties: {
                                    mode: { const: 'authorization-bearer' },
                                    token: { type: 'string' }
                                  }
                                },
                                {
                                  type: 'object',
                                  additionalProperties: false,
                                  properties: {
                                    mode: { const: 'header' },
                                    headerName: { type: 'string' },
                                    value: { type: 'string' }
                                  }
                                }
                              ]
                            }
                          }
                        }
                      ]
                    },
                    models: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          compat: {
                            type: 'object',
                            additionalProperties: false,
                            properties: { supportsStore: { type: 'boolean' } }
                          },
                          cost: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                              input: { type: 'number' },
                              output: { type: 'number' },
                              tieredPricing: {
                                type: 'array',
                                items: {
                                  type: 'object',
                                  additionalProperties: false,
                                  properties: {
                                    input: { type: 'number' },
                                    output: { type: 'number' },
                                    range: {}
                                  }
                                }
                              }
                            }
                          },
                          params: { type: 'object', additionalProperties: true }
                        }
                      }
                    }
                  },
                  allOf: [
                    {},
                    {
                      type: 'object',
                      additionalProperties: false,
                      properties: { baseUrl: {}, apiKey: {}, api: {}, request: {}, models: {} }
                    }
                  ]
                }
              }
            }
          }
        }
      })
      fs.writeFileSync(
        path.join(configDir, 'openclaw.json'),
        JSON.stringify({
          models: {
            providers: {
              'cherry-openai': {
                request: {
                  allowPrivateNetwork: true,
                  removedField: 'drop',
                  auth: {
                    mode: 'header',
                    headerName: 'X-API-Key',
                    value: 'manual-secret',
                    token: 'drop-from-other-branch',
                    removedAuthField: 'drop'
                  }
                },
                models: [
                  {
                    id: 'gpt-4o',
                    name: 'GPT-4o',
                    compat: { supportsStore: true, removedFlag: true },
                    cost: {
                      input: 2,
                      output: 8,
                      removedCostField: 1,
                      tieredPricing: [{ input: 1, output: 4, range: [0, 1000], removedTierField: true }]
                    },
                    params: { customOption: { nested: 'keep' } }
                  }
                ]
              }
            }
          }
        })
      )

      const result = await service.syncProviderConfig(
        { ...legacyProvider, headers: { 'X-Synced': 'drop-because-allOf-forbids-it' } },
        legacyModel
      )

      expect(result).toEqual({ success: true })
      const written = JSON.parse(fs.readFileSync(path.join(configDir, 'openclaw.json'), 'utf-8'))
      const managedProvider = written.models.providers['cherry-openai']
      expect(managedProvider.headers).toBeUndefined()
      expect(managedProvider.request).toEqual({
        allowPrivateNetwork: true,
        auth: { mode: 'header', headerName: 'X-API-Key', value: 'manual-secret' }
      })
      expect(managedProvider.models[0]).toEqual({
        id: 'gpt-4o',
        name: 'GPT-4o',
        compat: { supportsStore: true },
        cost: {
          input: 2,
          output: 8,
          tieredPricing: [{ input: 1, output: 4, range: [0, 1000] }]
        },
        params: { customOption: { nested: 'keep' } }
      })
    })

    it('emits only optional provider and model fields supported by the resolved OpenClaw schema', async () => {
      schemaCapabilitySpy.mockResolvedValueOnce(createRuntimeConfigSchema(['contextWindow', 'reasoning', 'input'], []))
      fs.writeFileSync(
        path.join(configDir, 'openclaw.json'),
        JSON.stringify({ tools: { web: { fetch: { ssrfPolicy: { allowPrivateNetwork: false } } } } })
      )
      const provider = {
        ...legacyProvider,
        headers: { 'X-Synced': 'synced' },
        models: [
          {
            id: 'gpt-4o',
            name: 'GPT-4o',
            contextWindow: 128000,
            maxTokens: 16384,
            reasoning: true,
            input: ['text', 'image'],
            cost: { input: 2, output: 8 }
          }
        ]
      }

      const result = await service.syncProviderConfig(provider, legacyModel)

      expect(result).toEqual({ success: true })
      const written = JSON.parse(fs.readFileSync(path.join(configDir, 'openclaw.json'), 'utf-8'))
      expect(written.models.providers['cherry-openai']).toEqual({
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        api: 'openai-completions',
        models: [
          {
            id: 'gpt-4o',
            name: 'GPT-4o',
            contextWindow: 128000,
            reasoning: true,
            input: ['text', 'image']
          }
        ]
      })
      expect(written.tools).toEqual({
        web: { fetch: { ssrfPolicy: { allowPrivateNetwork: false } } }
      })
    })

    it('keeps the formal config unchanged when validation reports a different path', async () => {
      const configPath = path.join(configDir, 'openclaw.json')
      const original = '{"tools":{"web":{"search":{"enabled":true}}}}'
      fs.writeFileSync(configPath, original, 'utf-8')
      validateConfigSpy.mockRestore()
      runOpenClawCommandSpy.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({ valid: true, path: '/mock/default/openclaw.json', warnings: [] }),
        stderr: '',
        outputTruncated: false
      })

      const result = await service.syncProviderConfig(legacyProvider, legacyModel)

      expect(result.success).toBe(false)
      expect('message' in result && result.message).toContain('incompatible with the generated configuration')
      expect(fs.readFileSync(configPath, 'utf-8')).toBe(original)
      expect(fs.readdirSync(configDir).some((entry) => entry.includes('cherry-candidate'))).toBe(false)
    })

    it.each([
      { state: 'empty', initialToken: '' },
      { state: 'existing', initialToken: 'existing-memory-token' }
    ])(
      'keeps the formal config and $state in-memory token unchanged when external config is invalid',
      async ({ initialToken }) => {
        const configPath = path.join(configDir, 'openclaw.json')
        const original =
          '{"gateway":{"auth":{"token":"formal-token"}},"tools":{"web":{"fetch":{"ssrfPolicy":{"allowPrivateNetwork":false}}}}}'
        fs.writeFileSync(configPath, original, 'utf-8')
        ;(service as any).gatewayAuthToken = initialToken
        validateConfigSpy.mockResolvedValueOnce({
          valid: false,
          path: '/ignored/by-test',
          issues: [{ path: 'tools.web.fetch.ssrfPolicy', message: 'Unsupported field' }],
          warnings: []
        })

        const result = await service.syncProviderConfig(legacyProvider, legacyModel)

        expect(result.success).toBe(false)
        expect('message' in result && result.message).toContain("outside Cherry Studio's managed provider section")
        expect((service as any).gatewayAuthToken).toBe(initialToken)
        expect(fs.readFileSync(configPath, 'utf-8')).toBe(original)
        const candidatePath = validateConfigSpy.mock.calls[0][1] as string
        expect(path.dirname(candidatePath)).toBe(configDir)
        expect(path.basename(candidatePath)).toContain('openclaw.json.cherry-candidate-')
        expect(fs.existsSync(candidatePath)).toBe(false)
      }
    )

    it('publishes a generated token only after candidate validation and a successful formal write', async () => {
      let tokenDuringValidation = ''
      let candidateToken = ''
      validateConfigSpy.mockImplementationOnce(async (_runtime, candidatePath) => {
        const configPath = candidatePath as string
        tokenDuringValidation = (service as any).gatewayAuthToken
        candidateToken = JSON.parse(fs.readFileSync(configPath, 'utf-8')).gateway.auth.token
        return { valid: true, path: configPath, issues: [], warnings: [] }
      })

      const result = await service.syncProviderConfig(legacyProvider, legacyModel)
      const written = JSON.parse(fs.readFileSync(path.join(configDir, 'openclaw.json'), 'utf-8'))

      expect(result).toEqual({ success: true })
      expect(candidateToken).not.toBe('')
      expect(tokenDuringValidation).toBe('')
      expect(written.gateway.auth.token).toBe(candidateToken)
      expect((service as any).gatewayAuthToken).toBe(candidateToken)
    })

    it('redacts and limits external validation issues returned in the operation result', async () => {
      const firstSecret = 'sk-first-sensitive'
      const secondSecret = 'bearer-second-sensitive'
      validateConfigSpy.mockResolvedValueOnce({
        valid: false,
        issues: [
          { path: 'tools.web.fetch.apiKey', message: firstSecret },
          { path: 'tools.web.search.authorization', message: `Bearer ${secondSecret}` },
          { path: 'tools.web.fetch.third', message: 'third problem' },
          { path: 'tools.web.fetch.fourth', message: 'fourth problem' },
          { path: 'tools.web.fetch.fifth', message: 'fifth problem' }
        ],
        warnings: []
      })

      const result = await service.syncProviderConfig(legacyProvider, legacyModel)
      const message = 'message' in result ? result.message : ''

      expect(result.success).toBe(false)
      expect(message).not.toContain(firstSecret)
      expect(message).not.toContain(secondSecret)
      expect(message).toContain('tools.web.fetch.apiKey')
      expect(message).toContain('tools.web.search.authorization')
      expect(message).toContain('tools.web.fetch.third')
      expect(message).not.toContain('tools.web.fetch.fourth')
      expect(message).not.toContain('tools.web.fetch.fifth')
      expect(message).toContain('and 2 more')
    })

    it('classifies rejected Cherry-generated fields as binary incompatibility without changing the formal file', async () => {
      const configPath = path.join(configDir, 'openclaw.json')
      const original = '{"tools":{"web":{"search":{"enabled":true}}}}'
      fs.writeFileSync(configPath, original, 'utf-8')
      validateConfigSpy.mockResolvedValueOnce({
        valid: false,
        issues: [{ path: 'models.providers.cherry-openai.models.0.contextWindow', message: 'Unknown field' }],
        warnings: []
      })

      const result = await service.syncProviderConfig(legacyProvider, legacyModel)

      expect(result.success).toBe(false)
      expect('message' in result && result.message).toContain('incompatible with the generated configuration')
      expect(fs.readFileSync(configPath, 'utf-8')).toBe(original)
      expect(fs.readdirSync(configDir).some((entry) => entry.includes('cherry-candidate'))).toBe(false)
    })

    it('validates a same-directory candidate, removes it, and atomically writes the formal config as 0600', async () => {
      const result = await service.syncProviderConfig(legacyProvider, legacyModel)

      expect(result).toEqual({ success: true })
      const configPath = path.join(configDir, 'openclaw.json')
      const candidatePath = validateConfigSpy.mock.calls[0][1] as string
      expect(path.dirname(candidatePath)).toBe(path.dirname(configPath))
      expect(path.basename(candidatePath)).toContain('openclaw.json.cherry-candidate-')
      expect(fs.existsSync(candidatePath)).toBe(false)
      expect(fs.statSync(configPath).mode & 0o777).toBe(0o600)
    })

    it('returns a sanitized preflight failure and leaves the formal file unchanged for malformed validation output', async () => {
      const configPath = path.join(configDir, 'openclaw.json')
      const original = '{"tools":{"web":{"search":{"enabled":true}}}}'
      const stdoutSecret = 'sk-stdout-sensitive'
      const stderrSecret = 'stderr-bearer-sensitive'
      fs.writeFileSync(configPath, original, 'utf-8')
      validateConfigSpy.mockRestore()
      runOpenClawCommandSpy.mockResolvedValueOnce({
        exitCode: 0,
        stdout: `not JSON apiKey: ${stdoutSecret}`,
        stderr: `Bearer ${stderrSecret}`,
        outputTruncated: false
      })

      const result = await service.syncProviderConfig(legacyProvider, legacyModel)
      const message = 'message' in result ? result.message : ''

      expect(result.success).toBe(false)
      expect(message).toContain('could not validate the OpenClaw configuration')
      expect(message).not.toContain(stdoutSecret)
      expect(message).not.toContain(stderrSecret)
      expect(message).not.toContain('not JSON')
      expect(fs.readFileSync(configPath, 'utf-8')).toBe(original)
      const validateCall = runOpenClawCommandSpy.mock.calls.find((call) => (call[1] as string[])[1] === 'validate')
      const candidatePath = (validateCall?.[2] as Record<string, string> | undefined)?.OPENCLAW_CONFIG_PATH
      expect(path.dirname(candidatePath as string)).toBe(configDir)
      expect(fs.existsSync(candidatePath as string)).toBe(false)
    })
  })

  // ─── Full state transition scenarios ─────────────────────────

  describe('full lifecycle transitions', () => {
    it('stopped → starting → running → (crash) → stopped', async () => {
      expect((service as any).gatewayStatus).toBe('stopped')

      // Start
      checkPortOpenSpy.mockResolvedValue(false)
      findBinarySpy.mockResolvedValue({ source: 'mise', path: '/mock/bin/openclaw', version: '1.0.0' })
      startAndWaitSpy.mockResolvedValue(undefined)
      await service.startGateway()
      expect((service as any).gatewayStatus).toBe('running')

      // Gateway crashes externally — getStatus detects it
      checkHealthSpy.mockResolvedValue({ status: 'unhealthy', gatewayPort: 18790 })
      const status = await service.getStatus()
      expect(status.status).toBe('stopped')
    })

    it('stopped → starting → error → (external recovery) → running', async () => {
      // Start fails
      checkPortOpenSpy.mockResolvedValue(false)
      findBinarySpy.mockResolvedValue({ source: 'mise', path: '/mock/bin/openclaw', version: '1.0.0' })
      startAndWaitSpy.mockRejectedValue(new Error('timeout'))
      await service.startGateway()
      expect((service as any).gatewayStatus).toBe('error')

      // External recovery — someone starts gateway manually
      checkHealthSpy.mockResolvedValue({ status: 'healthy', gatewayPort: 18790 })
      const status = await service.getStatus()
      expect(status.status).toBe('running')
    })

    it('running → getStatus unhealthy → stopped → getStatus healthy → running', async () => {
      ;(service as any).gatewayStatus = 'running'

      // getStatus detects crash
      checkHealthSpy.mockResolvedValue({ status: 'unhealthy', gatewayPort: 18790 })
      const crashed = await service.getStatus()
      expect(crashed.status).toBe('stopped')

      // getStatus detects recovery
      checkHealthSpy.mockResolvedValue({ status: 'healthy', gatewayPort: 18790 })
      const recovered = await service.getStatus()
      expect(recovered.status).toBe('running')
    })
  })
})
