import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProcessorRegistry } from '../registry/ProcessorRegistry'
import { createMockTemplate, MockTextExtractor } from './mocks/MockProcessor'

const testProcessorIds = ['test-processor', 'image-processor', 'doc-processor', 'processor-1', 'processor-2']

describe('ProcessorRegistry', () => {
  beforeEach(() => {
    const registry = ProcessorRegistry.getInstance()
    for (const id of testProcessorIds) {
      registry.unregister(id)
    }
  })

  describe('getInstance', () => {
    it('should return the same instance', () => {
      const instance1 = ProcessorRegistry.getInstance()
      const instance2 = ProcessorRegistry.getInstance()
      expect(instance1).toBe(instance2)
    })
  })

  describe('register', () => {
    it('should register a processor', () => {
      const registry = ProcessorRegistry.getInstance()
      const processor = new MockTextExtractor(createMockTemplate({ id: 'test-processor' }))

      registry.register(processor)

      expect(registry.get('test-processor')).toBe(processor)
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
      expect(registry.get('test-processor')).toBeUndefined()
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

  describe('getAll', () => {
    it('should return all available processors', async () => {
      const registry = ProcessorRegistry.getInstance()
      const processor1 = new MockTextExtractor(createMockTemplate({ id: 'processor-1' }))
      const processor2 = new MockTextExtractor(createMockTemplate({ id: 'processor-2' }))
      vi.spyOn(processor1, 'isAvailable').mockResolvedValue(true)
      vi.spyOn(processor2, 'isAvailable').mockResolvedValue(true)

      registry.register(processor1)
      registry.register(processor2)

      const all = await registry.getAll()

      expect(all).toEqual(expect.arrayContaining([processor1, processor2]))
    })

    it('should return only available processors', async () => {
      const registry = ProcessorRegistry.getInstance()
      const availableProcessor = new MockTextExtractor(createMockTemplate({ id: 'processor-1' }))
      const unavailableProcessor = new MockTextExtractor(createMockTemplate({ id: 'processor-2' }))
      vi.spyOn(availableProcessor, 'isAvailable').mockResolvedValue(true)
      vi.spyOn(unavailableProcessor, 'isAvailable').mockResolvedValue(false)

      registry.register(availableProcessor)
      registry.register(unavailableProcessor)

      const all = await registry.getAll()

      expect(all).toEqual(expect.arrayContaining([availableProcessor]))
      expect(all).not.toContain(unavailableProcessor)
    })
  })
})
