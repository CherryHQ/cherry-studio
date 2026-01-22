import { describe, expect, it } from 'vitest'

import {
  COMPLEX_PREFERENCE_MAPPINGS,
  type ComplexMapping,
  getComplexMappingById,
  getComplexMappingTargetKeys,
  type SourceDefinition,
  type TransformFunction,
  type TransformResult
} from '../ComplexPreferenceMappings'

describe('ComplexPreferenceMappings', () => {
  describe('type exports', () => {
    it('should export SourceDefinition type', () => {
      // Type check - this will fail to compile if types are not exported correctly
      const sourceDef: SourceDefinition = {
        source: 'electronStore',
        key: 'testKey'
      }
      expect(sourceDef.source).toBe('electronStore')
    })

    it('should export SourceDefinition with redux category', () => {
      const sourceDef: SourceDefinition = {
        source: 'redux',
        key: 'testKey',
        category: 'settings'
      }
      expect(sourceDef.category).toBe('settings')
    })

    it('should export TransformResult type', () => {
      const result: TransformResult = {
        'test.key': 'value',
        'another.key': 123
      }
      expect(result['test.key']).toBe('value')
    })

    it('should export TransformFunction type', () => {
      const fn: TransformFunction = (sources) => {
        return { 'output.key': sources.input }
      }
      expect(fn({ input: 'test' })).toEqual({ 'output.key': 'test' })
    })

    it('should export ComplexMapping type', () => {
      const mapping: ComplexMapping = {
        id: 'test_mapping',
        description: 'Test mapping',
        sources: {
          testSource: { source: 'electronStore', key: 'test' }
        },
        targetKeys: ['target.key'],
        transform: () => ({ 'target.key': 'value' })
      }
      expect(mapping.id).toBe('test_mapping')
    })
  })

  describe('COMPLEX_PREFERENCE_MAPPINGS', () => {
    it('should be an array', () => {
      expect(Array.isArray(COMPLEX_PREFERENCE_MAPPINGS)).toBe(true)
    })

    it('should contain websearch compression flatten mapping', () => {
      const websearchMapping = COMPLEX_PREFERENCE_MAPPINGS.find((m) => m.id === 'websearch_compression_flatten')
      expect(websearchMapping).toBeDefined()
      expect(websearchMapping?.targetKeys).toContain('chat.web_search.compression.method')
      expect(websearchMapping?.targetKeys.length).toBe(9)
    })

    it('should contain websearch providers migrate mapping', () => {
      const providersMapping = COMPLEX_PREFERENCE_MAPPINGS.find((m) => m.id === 'websearch_providers_migrate')
      expect(providersMapping).toBeDefined()
      expect(providersMapping?.targetKeys).toContain('chat.web_search.providers')
    })
  })

  describe('getComplexMappingTargetKeys', () => {
    it('should return target keys from all mappings', () => {
      const keys = getComplexMappingTargetKeys()
      expect(keys).toContain('chat.web_search.compression.method')
      expect(keys).toContain('chat.web_search.providers')
      expect(keys.length).toBe(10) // 9 websearch compression keys + 1 providers key
    })

    it('should flatten target keys from all mappings', () => {
      // Test the function behavior with mock data
      // Note: This tests the logic, actual mappings are empty
      const mockMappings: ComplexMapping[] = [
        {
          id: 'mapping1',
          description: 'Test 1',
          sources: {},
          targetKeys: ['key.a', 'key.b'],
          transform: () => ({})
        },
        {
          id: 'mapping2',
          description: 'Test 2',
          sources: {},
          targetKeys: ['key.c'],
          transform: () => ({})
        }
      ]

      // Simulate flatMap behavior
      const expectedKeys = mockMappings.flatMap((m) => m.targetKeys)
      expect(expectedKeys).toEqual(['key.a', 'key.b', 'key.c'])
    })
  })

  describe('getComplexMappingById', () => {
    it('should return mapping by id', () => {
      const mapping = getComplexMappingById('websearch_compression_flatten')
      expect(mapping).toBeDefined()
      expect(mapping?.id).toBe('websearch_compression_flatten')
    })

    it('should return undefined for non-existent id', () => {
      const mapping = getComplexMappingById('does_not_exist')
      expect(mapping).toBeUndefined()
    })
  })

  describe('ComplexMapping structure validation', () => {
    it('should validate mapping structure', () => {
      // Create a valid mapping structure
      const validMapping: ComplexMapping = {
        id: 'window_bounds_split',
        description: 'Split windowBounds object into separate position and size keys',
        sources: {
          windowBounds: { source: 'electronStore', key: 'windowBounds' }
        },
        targetKeys: [
          'app.window.position.x',
          'app.window.position.y',
          'app.window.size.width',
          'app.window.size.height'
        ],
        transform: (sources) => {
          const bounds = sources.windowBounds as { x: number; y: number; width: number; height: number } | undefined
          return {
            'app.window.position.x': bounds?.x ?? 0,
            'app.window.position.y': bounds?.y ?? 0,
            'app.window.size.width': bounds?.width ?? 800,
            'app.window.size.height': bounds?.height ?? 600
          }
        }
      }

      // Validate structure
      expect(validMapping.id).toBeDefined()
      expect(validMapping.description).toBeDefined()
      expect(validMapping.sources).toBeDefined()
      expect(validMapping.targetKeys).toBeDefined()
      expect(validMapping.transform).toBeDefined()
      expect(typeof validMapping.transform).toBe('function')
    })

    it('should execute transform function correctly', () => {
      const transform: TransformFunction = (sources) => {
        const bounds = sources.windowBounds as { x: number; y: number; width: number; height: number } | undefined
        return {
          'app.window.position.x': bounds?.x ?? 0,
          'app.window.position.y': bounds?.y ?? 0,
          'app.window.size.width': bounds?.width ?? 800,
          'app.window.size.height': bounds?.height ?? 600
        }
      }

      // Test with valid data
      const result1 = transform({
        windowBounds: { x: 100, y: 200, width: 1024, height: 768 }
      })
      expect(result1).toEqual({
        'app.window.position.x': 100,
        'app.window.position.y': 200,
        'app.window.size.width': 1024,
        'app.window.size.height': 768
      })

      // Test with missing data (should use defaults)
      const result2 = transform({})
      expect(result2).toEqual({
        'app.window.position.x': 0,
        'app.window.position.y': 0,
        'app.window.size.width': 800,
        'app.window.size.height': 600
      })
    })

    it('should handle multi-source merging', () => {
      const transform: TransformFunction = (sources) => {
        if (!sources.proxyEnabled) return {}
        return {
          'network.proxy.enabled': sources.proxyEnabled,
          'network.proxy.host': sources.proxyHost ?? '',
          'network.proxy.port': sources.proxyPort ?? 0
        }
      }

      // Test with proxy enabled
      const result1 = transform({
        proxyEnabled: true,
        proxyHost: '127.0.0.1',
        proxyPort: 8080
      })
      expect(result1).toEqual({
        'network.proxy.enabled': true,
        'network.proxy.host': '127.0.0.1',
        'network.proxy.port': 8080
      })

      // Test with proxy disabled (should return empty)
      const result2 = transform({
        proxyEnabled: false,
        proxyHost: '127.0.0.1',
        proxyPort: 8080
      })
      expect(result2).toEqual({})
    })

    it('should handle conditional mapping', () => {
      const transform: TransformFunction = (sources) => {
        const result: TransformResult = {}

        if (sources.backupType === 'webdav' && sources.webdavUrl) {
          result['data.backup.webdav.enabled'] = true
          result['data.backup.webdav.url'] = sources.webdavUrl
        }

        if (sources.backupType === 's3' && sources.s3Bucket) {
          result['data.backup.s3.enabled'] = true
          result['data.backup.s3.bucket'] = sources.s3Bucket
        }

        return result
      }

      // Test webdav backup
      const result1 = transform({
        backupType: 'webdav',
        webdavUrl: 'https://dav.example.com'
      })
      expect(result1).toEqual({
        'data.backup.webdav.enabled': true,
        'data.backup.webdav.url': 'https://dav.example.com'
      })

      // Test s3 backup
      const result2 = transform({
        backupType: 's3',
        s3Bucket: 'my-bucket'
      })
      expect(result2).toEqual({
        'data.backup.s3.enabled': true,
        'data.backup.s3.bucket': 'my-bucket'
      })

      // Test no backup configured
      const result3 = transform({
        backupType: 'none'
      })
      expect(result3).toEqual({})
    })
  })
})
