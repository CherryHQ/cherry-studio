import { describe, expect, it } from 'vitest'

import { extractFileId } from '../FileCollector'

describe('FileCollector', () => {
  describe('extractFileId', () => {
    it('extracts fileId from file blocks', () => {
      expect(extractFileId({ type: 'file', fileId: 'abc-123' })).toBe('abc-123')
    })

    it('extracts fileId from image blocks', () => {
      expect(extractFileId({ type: 'image', fileId: 'img-456' })).toBe('img-456')
    })

    it('returns null for image blocks without fileId', () => {
      expect(extractFileId({ type: 'image', url: 'https://example.com' })).toBeNull()
    })

    it('returns null for text blocks', () => {
      expect(extractFileId({ type: 'main_text', content: 'hello' })).toBeNull()
    })

    it('returns null for thinking blocks', () => {
      expect(extractFileId({ type: 'thinking', content: 'reasoning' })).toBeNull()
    })

    it('returns null for tool blocks', () => {
      expect(extractFileId({ type: 'tool', toolId: 't1' })).toBeNull()
    })

    it('returns null for unknown block types', () => {
      expect(extractFileId({ type: 'unknown' })).toBeNull()
    })

    it('handles file blocks without fileId', () => {
      expect(extractFileId({ type: 'file' })).toBeNull()
    })
  })
})
