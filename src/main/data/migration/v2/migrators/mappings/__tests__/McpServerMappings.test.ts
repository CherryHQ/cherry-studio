import { describe, expect, it } from 'vitest'

import { transformMcpServer } from '../McpServerMappings'

const NULL_FIELDS = {
  type: null,
  description: null,
  baseUrl: null,
  command: null,
  registryUrl: null,
  args: null,
  env: null,
  headers: null,
  provider: null,
  providerUrl: null,
  logoUrl: null,
  tags: null,
  longRunning: null,
  timeout: null,
  dxtVersion: null,
  dxtPath: null,
  reference: null,
  searchKey: null,
  configSample: null,
  disabledTools: null,
  disabledAutoApproveTools: null,
  shouldConfig: null,
  installSource: null,
  isTrusted: null,
  trustedAt: null,
  installedAt: null
}

describe('McpServerMappings', () => {
  describe('transformMcpServer', () => {
    it('should transform a full MCPServer record', () => {
      const source = {
        id: 'srv-1',
        name: '@cherry/fetch',
        type: 'inMemory',
        description: 'Fetch tool',
        baseUrl: 'http://localhost:3000',
        command: 'npx',
        registryUrl: 'https://registry.example.com',
        args: ['-y', 'some-package'],
        env: { API_KEY: 'key123' },
        headers: { Authorization: 'Bearer token' },
        provider: 'CherryAI',
        providerUrl: 'https://cherry.ai',
        logoUrl: 'https://cherry.ai/logo.png',
        tags: ['search', 'web'],
        longRunning: true,
        timeout: 120,
        dxtVersion: '1.0.0',
        dxtPath: '/path/to/dxt',
        reference: 'https://docs.example.com',
        searchKey: 'fetch-tool',
        configSample: { title: 'Sample', properties: { key: { type: 'string' } } },
        disabledTools: ['tool1'],
        disabledAutoApproveTools: ['tool2'],
        shouldConfig: true,
        isActive: true,
        installSource: 'builtin',
        isTrusted: true,
        trustedAt: 1700000000000,
        installedAt: 1699000000000
      }

      expect(transformMcpServer(source)).toStrictEqual(source)
    })

    it('should handle minimal MCPServer (only required fields)', () => {
      expect(transformMcpServer({ id: 'srv-2', name: 'my-server', isActive: false })).toStrictEqual({
        ...NULL_FIELDS,
        id: 'srv-2',
        name: 'my-server',
        isActive: false
      })
    })

    it('should handle null and undefined optional fields', () => {
      const source = {
        id: 'srv-3',
        name: 'test',
        isActive: true,
        type: undefined,
        description: null,
        args: undefined,
        env: null
      }
      expect(transformMcpServer(source as any)).toStrictEqual({
        ...NULL_FIELDS,
        id: 'srv-3',
        name: 'test',
        isActive: true
      })
    })

    it('should default isActive to false when missing', () => {
      expect(transformMcpServer({ id: 'srv-4', name: 'no-active-field' } as any)).toStrictEqual({
        ...NULL_FIELDS,
        id: 'srv-4',
        name: 'no-active-field',
        isActive: false
      })
    })

    it('should preserve empty arrays', () => {
      expect(
        transformMcpServer({
          id: 'srv-5',
          name: 'empty-arrays',
          isActive: false,
          args: [],
          tags: [],
          disabledTools: []
        })
      ).toStrictEqual({
        ...NULL_FIELDS,
        id: 'srv-5',
        name: 'empty-arrays',
        isActive: false,
        args: [],
        tags: [],
        disabledTools: []
      })
    })

    it('should preserve empty objects', () => {
      expect(
        transformMcpServer({ id: 'srv-6', name: 'empty-objects', isActive: false, env: {}, headers: {} })
      ).toStrictEqual({
        ...NULL_FIELDS,
        id: 'srv-6',
        name: 'empty-objects',
        isActive: false,
        env: {},
        headers: {}
      })
    })
  })
})
