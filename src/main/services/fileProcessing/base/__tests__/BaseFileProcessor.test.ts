import type { FileProcessorMerged, FileProcessorTemplate } from '@shared/data/presets/file-processing'
import { beforeEach, describe, expect, it } from 'vitest'

import { BaseFileProcessor } from '../BaseFileProcessor'

// Concrete implementation for testing
class TestProcessor extends BaseFileProcessor {
  constructor(template: FileProcessorTemplate) {
    super(template)
  }

  // Expose protected method for testing
  public testGetApiKey(config: FileProcessorMerged): string | undefined {
    return this.getApiKey(config)
  }
}

function createMockTemplate(id: string = 'test-processor'): FileProcessorTemplate {
  return {
    id,
    type: 'api',
    capabilities: [{ feature: 'text_extraction', input: 'image', output: 'text' }]
  }
}

function createMockConfig(apiKeys?: string[]): FileProcessorMerged {
  return {
    id: 'test-processor',
    type: 'api',
    capabilities: [{ feature: 'text_extraction', input: 'image', output: 'text' }],
    apiKeys
  }
}

describe('BaseFileProcessor', () => {
  describe('getApiKey', () => {
    beforeEach(() => {
      // Reset the static apiKeyIndexMap before each test
      // @ts-expect-error - accessing private static for testing
      BaseFileProcessor.apiKeyIndexMap = new Map()
    })

    it('should return undefined when apiKeys is undefined', () => {
      const processor = new TestProcessor(createMockTemplate())
      const config = createMockConfig(undefined)

      expect(processor.testGetApiKey(config)).toBeUndefined()
    })

    it('should return undefined when apiKeys is empty', () => {
      const processor = new TestProcessor(createMockTemplate())
      const config = createMockConfig([])

      expect(processor.testGetApiKey(config)).toBeUndefined()
    })

    it('should return the only key when there is one key', () => {
      const processor = new TestProcessor(createMockTemplate())
      const config = createMockConfig(['key1'])

      expect(processor.testGetApiKey(config)).toBe('key1')
      expect(processor.testGetApiKey(config)).toBe('key1')
      expect(processor.testGetApiKey(config)).toBe('key1')
    })

    it('should round-robin through multiple keys', () => {
      const processor = new TestProcessor(createMockTemplate())
      const config = createMockConfig(['key1', 'key2', 'key3'])

      // First round
      expect(processor.testGetApiKey(config)).toBe('key1')
      expect(processor.testGetApiKey(config)).toBe('key2')
      expect(processor.testGetApiKey(config)).toBe('key3')

      // Second round (wraps around)
      expect(processor.testGetApiKey(config)).toBe('key1')
      expect(processor.testGetApiKey(config)).toBe('key2')
    })

    it('should maintain separate round-robin state for different processors', () => {
      const processor1 = new TestProcessor(createMockTemplate('processor-1'))
      const processor2 = new TestProcessor(createMockTemplate('processor-2'))
      const config1 = createMockConfig(['a1', 'a2', 'a3'])
      const config2 = createMockConfig(['b1', 'b2'])

      // processor1 calls
      expect(processor1.testGetApiKey(config1)).toBe('a1')
      expect(processor1.testGetApiKey(config1)).toBe('a2')

      // processor2 calls (should start from beginning)
      expect(processor2.testGetApiKey(config2)).toBe('b1')

      // processor1 continues
      expect(processor1.testGetApiKey(config1)).toBe('a3')

      // processor2 continues
      expect(processor2.testGetApiKey(config2)).toBe('b2')

      // Both wrap around
      expect(processor1.testGetApiKey(config1)).toBe('a1')
      expect(processor2.testGetApiKey(config2)).toBe('b1')
    })

    it('should handle two keys correctly', () => {
      const processor = new TestProcessor(createMockTemplate())
      const config = createMockConfig(['keyA', 'keyB'])

      expect(processor.testGetApiKey(config)).toBe('keyA')
      expect(processor.testGetApiKey(config)).toBe('keyB')
      expect(processor.testGetApiKey(config)).toBe('keyA')
      expect(processor.testGetApiKey(config)).toBe('keyB')
    })
  })
})
