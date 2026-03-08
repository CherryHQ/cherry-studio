import { describe, expect, it } from 'vitest'

import { transformMcpServer } from '../McpServerMappings'

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

      const result = transformMcpServer(source)

      expect(result.id).toBe('srv-1')
      expect(result.name).toBe('@cherry/fetch')
      expect(result.type).toBe('inMemory')
      expect(result.description).toBe('Fetch tool')
      expect(result.baseUrl).toBe('http://localhost:3000')
      expect(result.command).toBe('npx')
      expect(result.registryUrl).toBe('https://registry.example.com')
      expect(result.args).toEqual(['-y', 'some-package'])
      expect(result.env).toEqual({ API_KEY: 'key123' })
      expect(result.headers).toEqual({ Authorization: 'Bearer token' })
      expect(result.provider).toBe('CherryAI')
      expect(result.providerUrl).toBe('https://cherry.ai')
      expect(result.logoUrl).toBe('https://cherry.ai/logo.png')
      expect(result.tags).toEqual(['search', 'web'])
      expect(result.longRunning).toBe(true)
      expect(result.timeout).toBe(120)
      expect(result.dxtVersion).toBe('1.0.0')
      expect(result.dxtPath).toBe('/path/to/dxt')
      expect(result.reference).toBe('https://docs.example.com')
      expect(result.searchKey).toBe('fetch-tool')
      expect(result.configSample).toEqual({ title: 'Sample', properties: { key: { type: 'string' } } })
      expect(result.disabledTools).toEqual(['tool1'])
      expect(result.disabledAutoApproveTools).toEqual(['tool2'])
      expect(result.shouldConfig).toBe(true)
      expect(result.isActive).toBe(true)
      expect(result.installSource).toBe('builtin')
      expect(result.isTrusted).toBe(true)
      expect(result.trustedAt).toBe(1700000000000)
      expect(result.installedAt).toBe(1699000000000)
    })

    it('should handle minimal MCPServer (only required fields)', () => {
      const source = {
        id: 'srv-2',
        name: 'my-server',
        isActive: false
      }

      const result = transformMcpServer(source)

      expect(result.id).toBe('srv-2')
      expect(result.name).toBe('my-server')
      expect(result.isActive).toBe(false)
      expect(result.type).toBeNull()
      expect(result.description).toBeNull()
      expect(result.args).toBeNull()
      expect(result.env).toBeNull()
      expect(result.tags).toBeNull()
      expect(result.provider).toBeNull()
      expect(result.installSource).toBeNull()
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

      const result = transformMcpServer(source as any)

      expect(result.id).toBe('srv-3')
      expect(result.name).toBe('test')
      expect(result.isActive).toBe(true)
      expect(result.type).toBeNull()
      expect(result.description).toBeNull()
      expect(result.args).toBeNull()
      expect(result.env).toBeNull()
    })

    it('should default isActive to false when missing', () => {
      const source = {
        id: 'srv-4',
        name: 'no-active-field'
      }

      const result = transformMcpServer(source as any)
      expect(result.isActive).toBe(false)
    })

    it('should preserve empty arrays', () => {
      const source = {
        id: 'srv-5',
        name: 'empty-arrays',
        isActive: false,
        args: [],
        tags: [],
        disabledTools: []
      }

      const result = transformMcpServer(source)

      expect(result.args).toEqual([])
      expect(result.tags).toEqual([])
      expect(result.disabledTools).toEqual([])
    })

    it('should preserve empty objects', () => {
      const source = {
        id: 'srv-6',
        name: 'empty-objects',
        isActive: false,
        env: {},
        headers: {}
      }

      const result = transformMcpServer(source)

      expect(result.env).toEqual({})
      expect(result.headers).toEqual({})
    })
  })
})
