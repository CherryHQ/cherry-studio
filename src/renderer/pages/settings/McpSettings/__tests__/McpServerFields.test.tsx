import type { McpServer } from '@shared/data/types/mcpServer'
import { describe, expect, it } from 'vitest'

import { type McpFormValues, toMcpFormDefaultValues, toMcpServerFields } from '../McpServerFields'

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
})
