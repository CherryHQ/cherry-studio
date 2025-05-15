import { describe, expect, it } from 'vitest'

import { compress, decompress } from '../zip'

const jsonStr = JSON.stringify({ foo: 'bar', num: 42, arr: [1, 2, 3] })

// 辅助函数：生成大字符串
function makeLargeString(size: number) {
  return 'a'.repeat(size)
}

describe('zip', () => {
  describe('compress & decompress', () => {
    it('should compress and decompress a normal JSON string', async () => {
      const compressed = await compress(jsonStr)
      expect(compressed).toBeInstanceOf(Buffer)

      const decompressed = await decompress(compressed)
      expect(decompressed).toBe(jsonStr)
    })

    it('should handle empty string', async () => {
      const compressed = await compress('')
      expect(compressed).toBeInstanceOf(Buffer)
      const decompressed = await decompress(compressed)
      expect(decompressed).toBe('')
    })

    it('should handle large string', async () => {
      const largeStr = makeLargeString(100_000)
      const compressed = await compress(largeStr)
      expect(compressed).toBeInstanceOf(Buffer)
      expect(compressed.length).toBeLessThan(largeStr.length)
      const decompressed = await decompress(compressed)
      expect(decompressed).toBe(largeStr)
    })

    it('should throw error when decompressing invalid buffer', async () => {
      const invalidBuffer = Buffer.from('not a valid gzip', 'utf-8')
      await expect(decompress(invalidBuffer)).rejects.toThrow()
    })

    it('should throw error when compress input is not string', async () => {
      // @ts-expect-error purposely pass wrong type to test error branch
      await expect(compress(null)).rejects.toThrow()
      // @ts-expect-error purposely pass wrong type to test error branch
      await expect(compress(undefined)).rejects.toThrow()
      // @ts-expect-error purposely pass wrong type to test error branch
      await expect(compress(123)).rejects.toThrow()
    })

    it('should throw error when decompress input is not buffer', async () => {
      // @ts-expect-error purposely pass wrong type to test error branch
      await expect(decompress(null)).rejects.toThrow()
      // @ts-expect-error purposely pass wrong type to test error branch
      await expect(decompress(undefined)).rejects.toThrow()
      // @ts-expect-error purposely pass wrong type to test error branch
      await expect(decompress('string')).rejects.toThrow()
    })
  })
})
