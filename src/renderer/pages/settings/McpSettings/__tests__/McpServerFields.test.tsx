import { describe, expect, it } from 'vitest'

import type { McpServer } from '@shared/data/types/mcpServer'

import {
  buildMcpSchema,
  type McpFormValues,
  resolveMcpConfigInstallSource,
  resolveMcpConfigTransportType,
  showsEnvEditor,
  toMcpFormDefaultValues,
  toMcpServerFields
} from '../McpServerFields'

const stdioFormValues = (overrides: Partial<McpFormValues> = {}): McpFormValues => ({
  name: 'Test server',
  description: '',
  serverType: 'stdio',
  baseUrl: '',
  command: 'npx',
  registryUrl: '',
  args: '',
  env: '',
  isActive: false,
  headers: '',
  longRunning: false,
  timeout: undefined,
  provider: '',
  providerUrl: '',
  logoUrl: '',
  tags: [],
  ...overrides
})

describe('toMcpServerFields', () => {
  it('clears environment variables when the stdio env input is empty', () => {
    expect(toMcpServerFields(stdioFormValues()).env).toEqual({})
  })

  it('keeps the API key of a hosted built-in server that connects over HTTP', () => {
    // QVeris authenticates with env.QVERIS_API_KEY whatever transport it uses; dropping env
    // on save would leave a migrated or freshly installed server permanently unconfigurable.
    const values = stdioFormValues({
      serverType: 'streamableHttp',
      baseUrl: 'https://mcp.qveris.ai/mcp',
      command: '',
      env: 'QVERIS_API_KEY=secret'
    })

    expect(toMcpServerFields(values).env).toEqual({ QVERIS_API_KEY: 'secret' })
  })

  it('clears headers when the remote server headers input is empty', () => {
    const values = stdioFormValues({
      serverType: 'streamableHttp',
      baseUrl: 'https://example.com/mcp',
      command: ''
    })

    expect(toMcpServerFields(values).headers).toEqual({})
  })
})

describe('env and headers round trip through the edit form', () => {
  // Values reach the DB intact through JSON import or migration. Opening the edit form and
  // saving an unrelated field must hand them back unchanged instead of re-parsing a lossy line.
  it('preserves env values containing # or newlines', () => {
    const server = {
      id: '6559f6b3-0f0e-4dc7-aab8-8f0906a9eaa3',
      name: 'pg-analytics',
      type: 'stdio',
      command: 'npx',
      isActive: false,
      env: { PGPASSWORD: 'Q7#mk29p', PRIVATE_KEY: '-----BEGIN KEY-----\nabc\n-----END KEY-----' }
    } satisfies McpServer

    const values = stdioFormValues({ env: toMcpFormDefaultValues(server).env })

    expect(toMcpServerFields(values).env).toEqual(server.env)
  })

  it('preserves header values containing #', () => {
    const server = {
      id: '6559f6b3-0f0e-4dc7-aab8-8f0906a9eaa3',
      name: 'Remote server',
      type: 'streamableHttp',
      baseUrl: 'https://example.com/mcp',
      isActive: false,
      headers: { Authorization: 'Bearer x#y' }
    } satisfies McpServer

    const values = stdioFormValues({
      serverType: 'streamableHttp',
      baseUrl: server.baseUrl,
      command: '',
      headers: toMcpFormDefaultValues(server).headers
    })

    expect(toMcpServerFields(values).headers).toEqual(server.headers)
  })
})

describe('toMcpFormDefaultValues', () => {
  it('maps persisted server values into the initial form state', () => {
    const server = {
      id: '6559f6b3-0f0e-4dc7-aab8-8f0906a9eaa3',
      name: 'Remote server',
      type: 'streamableHttp',
      baseUrl: 'https://example.com/mcp',
      isActive: false
    } satisfies McpServer

    expect(toMcpFormDefaultValues(server)).toMatchObject({
      name: 'Remote server',
      serverType: 'streamableHttp',
      baseUrl: 'https://example.com/mcp'
    })
  })

  it('leaves a missing server type unset instead of guessing from the URL', () => {
    const server = {
      id: '756b5a35-63f0-43d5-ab5f-163619d8798b',
      name: 'Legacy remote server',
      baseUrl: 'https://example.com/sse',
      isActive: false
    } satisfies McpServer

    expect(toMcpFormDefaultValues(server).serverType).toBeUndefined()
  })

  it('normalizes the legacy online-package built-in transport without guessing other missing types', () => {
    const server = {
      id: '7676dffa-53d7-4c35-abbb-e30cd9b27169',
      name: '@cherry/mcp-auto-install',
      type: 'inMemory',
      command: 'npx',
      isActive: false
    } satisfies McpServer

    expect(toMcpFormDefaultValues(server).serverType).toBe('stdio')
  })
})

describe('resolveMcpConfigTransportType', () => {
  it('exposes stdio configuration for the online-package built-in server', () => {
    expect(resolveMcpConfigTransportType('inMemory', '@cherry/mcp-auto-install')).toBe('stdio')
  })

  it('keeps other built-in servers on the in-memory configuration', () => {
    expect(resolveMcpConfigTransportType('inMemory', '@cherry/memory')).toBe('inMemory')
  })
})

describe('resolveMcpConfigInstallSource', () => {
  it('preserves the built-in identity of a legacy auto-install server', () => {
    expect(
      resolveMcpConfigInstallSource({
        name: '@cherry/mcp-auto-install',
        type: 'inMemory'
      })
    ).toBe('builtin')
  })

  it('does not classify other legacy servers as built-in', () => {
    expect(
      resolveMcpConfigInstallSource({
        name: 'Legacy server',
        type: 'inMemory'
      })
    ).toBeUndefined()
  })
})

describe('buildMcpSchema', () => {
  it('requires the command used by the online-package built-in server', () => {
    const result = buildMcpSchema((key) => key).safeParse(
      stdioFormValues({
        name: '@cherry/mcp-auto-install',
        serverType: 'inMemory',
        command: ''
      })
    )

    expect(result.success).toBe(false)
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ path: ['command'], message: 'settings.mcp.command' })
    )
  })
})

describe('showsEnvEditor', () => {
  it('offers env wherever the runtime reads it', () => {
    expect(showsEnvEditor('stdio')).toBe(true)
    expect(showsEnvEditor('inMemory')).toBe(true)
  })

  it('offers env to a hosted built-in that authenticates with one, such as QVeris', () => {
    expect(showsEnvEditor('streamableHttp', true)).toBe(true)
  })

  it('hides env from remote servers that never read it', () => {
    // flomo and Nowledge Mem are built-in HTTP servers with no env consumer.
    expect(showsEnvEditor('streamableHttp')).toBe(false)
    expect(showsEnvEditor('sse')).toBe(false)
  })
})
