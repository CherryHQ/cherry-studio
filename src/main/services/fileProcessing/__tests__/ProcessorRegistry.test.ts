import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProcessorRegistry } from '../registry/ProcessorRegistry'
import { createMockTemplate, MockTextExtractor } from './mocks/MockProcessor'

describe('ProcessorRegistry', () => {
  beforeEach(() => {
    ProcessorRegistry._resetForTesting()
  })

  describe('getInstance', () => {
    it('should return the same instance', () => {
      const instance1 = ProcessorRegistry.getInstance()
      const instance2 = ProcessorRegistry.getInstance()
      expect(instance1).toBe(instance2)
    })

    it('should return a new instance after reset', () => {
      const instance1 = ProcessorRegistry.getInstance()
      ProcessorRegistry._resetForTesting()
      const instance2 = ProcessorRegistry.getInstance()
      expect(instance1).not.toBe(instance2)
    })
  })

  describe('register', () => {
    it('should register a processor', () => {
      const registry = ProcessorRegistry.getInstance()
      const processor = new MockTextExtractor(createMockTemplate({ id: 'test-processor' }))

      registry.register(processor)

      expect(registry.has('test-processor')).toBe(true)
      expect(registry.size).toBe(1)
    })

    it('should throw on duplicate registration', () => {
      const registry = ProcessorRegistry.getInstance()
      const processor = new MockTextExtractor(createMockTemplate({ id: 'test-processor' }))

      registry.register(processor)

      expect(() => registry.register(processor)).toThrow('Processor "test-processor" is already registered')
    })
  })

  describe('unregister', () => {
    it('should remove a registered processor', () => {
      const registry = ProcessorRegistry.getInstance()
      const processor = new MockTextExtractor(createMockTemplate({ id: 'test-processor' }))

      registry.register(processor)
      const result = registry.unregister('test-processor')

      expect(result).toBe(true)
      expect(registry.has('test-processor')).toBe(false)
    })

    it('should return false for non-existent processor', () => {
      const registry = ProcessorRegistry.getInstance()

      const result = registry.unregister('non-existent')

      expect(result).toBe(false)
    })
  })

  describe('get', () => {
    it('should return registered processor', () => {
      const registry = ProcessorRegistry.getInstance()
      const processor = new MockTextExtractor(createMockTemplate({ id: 'test-processor' }))

      registry.register(processor)

      expect(registry.get('test-processor')).toBe(processor)
    })

    it('should return undefined for unknown processor', () => {
      const registry = ProcessorRegistry.getInstance()

      expect(registry.get('unknown')).toBeUndefined()
    })
  })

  describe('findByCapability', () => {
    it('should find processors matching feature and input type', () => {
      const registry = ProcessorRegistry.getInstance()
      const imageProcessor = new MockTextExtractor(
        createMockTemplate({
          id: 'image-processor',
          capabilities: [{ feature: 'text_extraction', input: 'image', output: 'text' }]
        })
      )
      const docProcessor = new MockTextExtractor(
        createMockTemplate({
          id: 'doc-processor',
          capabilities: [{ feature: 'to_markdown', input: 'document', output: 'markdown' }]
        })
      )

      registry.register(imageProcessor)
      registry.register(docProcessor)

      const imageResults = registry.findByCapability('text_extraction', 'image')
      expect(imageResults).toHaveLength(1)
      expect(imageResults[0].id).toBe('image-processor')

      const docResults = registry.findByCapability('to_markdown', 'document')
      expect(docResults).toHaveLength(1)
      expect(docResults[0].id).toBe('doc-processor')
    })

    it('should return empty array when no match', () => {
      const registry = ProcessorRegistry.getInstance()
      const processor = new MockTextExtractor(
        createMockTemplate({
          capabilities: [{ feature: 'text_extraction', input: 'image', output: 'text' }]
        })
      )

      registry.register(processor)

      const results = registry.findByCapability('to_markdown', 'document')
      expect(results).toHaveLength(0)
    })
  })

  describe('isAvailable', () => {
    it('should delegate to processor.isAvailable()', async () => {
      const registry = ProcessorRegistry.getInstance()
      const processor = new MockTextExtractor(createMockTemplate({ id: 'test-processor' }))
      vi.spyOn(processor, 'isAvailable').mockResolvedValue(true)

      registry.register(processor)

      const result = await registry.isAvailable('test-processor')

      expect(result).toBe(true)
      expect(processor.isAvailable).toHaveBeenCalled()
    })

    it('should return false when processor returns false', async () => {
      const registry = ProcessorRegistry.getInstance()
      const processor = new MockTextExtractor(createMockTemplate({ id: 'test-processor' }))
      vi.spyOn(processor, 'isAvailable').mockResolvedValue(false)

      registry.register(processor)

      const result = await registry.isAvailable('test-processor')

      expect(result).toBe(false)
    })

    it('should return false for unknown processor', async () => {
      const registry = ProcessorRegistry.getInstance()

      const result = await registry.isAvailable('unknown')

      expect(result).toBe(false)
    })
  })

  describe('getAll', () => {
    it('should return all registered processors', () => {
      const registry = ProcessorRegistry.getInstance()
      const processor1 = new MockTextExtractor(createMockTemplate({ id: 'processor-1' }))
      const processor2 = new MockTextExtractor(createMockTemplate({ id: 'processor-2' }))

      registry.register(processor1)
      registry.register(processor2)

      const all = registry.getAll()

      expect(all).toHaveLength(2)
      expect(all).toContain(processor1)
      expect(all).toContain(processor2)
    })

    it('should return empty array when no processors registered', () => {
      const registry = ProcessorRegistry.getInstance()

      expect(registry.getAll()).toHaveLength(0)
    })
  })

  describe('getAllIds', () => {
    it('should return all registered processor IDs', () => {
      const registry = ProcessorRegistry.getInstance()
      const processor1 = new MockTextExtractor(createMockTemplate({ id: 'processor-1' }))
      const processor2 = new MockTextExtractor(createMockTemplate({ id: 'processor-2' }))

      registry.register(processor1)
      registry.register(processor2)

      const ids = registry.getAllIds()

      expect(ids).toHaveLength(2)
      expect(ids).toContain('processor-1')
      expect(ids).toContain('processor-2')
    })
  })

  describe('has', () => {
    it('should return true for registered processor', () => {
      const registry = ProcessorRegistry.getInstance()
      const processor = new MockTextExtractor(createMockTemplate({ id: 'test-processor' }))

      registry.register(processor)

      expect(registry.has('test-processor')).toBe(true)
    })

    it('should return false for unknown processor', () => {
      const registry = ProcessorRegistry.getInstance()

      expect(registry.has('unknown')).toBe(false)
    })
  })

  describe('size', () => {
    it('should return the number of registered processors', () => {
      const registry = ProcessorRegistry.getInstance()

      expect(registry.size).toBe(0)

      registry.register(new MockTextExtractor(createMockTemplate({ id: 'processor-1' })))
      expect(registry.size).toBe(1)

      registry.register(new MockTextExtractor(createMockTemplate({ id: 'processor-2' })))
      expect(registry.size).toBe(2)

      registry.unregister('processor-1')
      expect(registry.size).toBe(1)
    })
  })
})
