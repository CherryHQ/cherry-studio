import { describe, expect, it } from 'vitest'

import { type McpFormValues, toMcpServerFields } from '../McpServerFields'

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
