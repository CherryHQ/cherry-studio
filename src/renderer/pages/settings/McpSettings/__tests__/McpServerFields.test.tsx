import { describe, expect, it } from 'vitest'

import {
  buildMcpSchema,
  type McpFormValues,
  resolveMcpConfigInstallSource,
  resolveMcpConfigTransportType,
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

  it('clears headers when the remote server headers input is empty', () => {
    const values = stdioFormValues({
      serverType: 'streamableHttp',
      baseUrl: 'https://example.com/mcp',
      command: ''
    })

    expect(toMcpServerFields(values).headers).toEqual({})
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
