import { describe, expect, it } from 'vitest'

import { findMissingBlockIds, mergeBlockReferences, type MigrationResult } from '../migrateBlockReferences.utils'

describe('migrateBlockReferences', () => {
  describe('findMissingBlockIds', () => {
    it('should return empty array when message.blocks matches blocks array', () => {
      const messageBlocks = ['id1', 'id2', 'id3']
      const blocks = [{ id: 'id1' }, { id: 'id2' }, { id: 'id3' }]

      const missing = findMissingBlockIds(messageBlocks, blocks)
      expect(missing).toEqual([])
    })

    it('should find block IDs that exist in blocks array but not in message.blocks', () => {
      const messageBlocks = ['id1', 'id2']
      const blocks = [{ id: 'id1' }, { id: 'id2' }, { id: 'id3' }, { id: 'id4' }]

      const missing = findMissingBlockIds(messageBlocks, blocks)
      expect(missing).toEqual(['id3', 'id4'])
    })

    it('should handle empty message.blocks', () => {
      const messageBlocks: string[] = []
      const blocks = [{ id: 'id1' }, { id: 'id2' }]

      const missing = findMissingBlockIds(messageBlocks, blocks)
      expect(missing).toEqual(['id1', 'id2'])
    })

    it('should handle empty blocks array', () => {
      const messageBlocks = ['id1', 'id2']
      const blocks: { id: string }[] = []

      const missing = findMissingBlockIds(messageBlocks, blocks)
      expect(missing).toEqual([])
    })

    it('should handle blocks without id field', () => {
      const messageBlocks = ['id1']
      const blocks = [{ id: 'id1' }, { notId: 'id2' } as any, { id: 'id3' }]

      const missing = findMissingBlockIds(messageBlocks, blocks)
      expect(missing).toEqual(['id3'])
    })
  })

  describe('mergeBlockReferences', () => {
    it('should append missing block IDs to message.blocks', () => {
      const messageBlocks = ['id1', 'id2']
      const missingIds = ['id3', 'id4']

      const merged = mergeBlockReferences(messageBlocks, missingIds)
      expect(merged).toEqual(['id1', 'id2', 'id3', 'id4'])
    })

    it('should preserve original order', () => {
      const messageBlocks = ['id1', 'id3']
      const missingIds = ['id2', 'id4']

      const merged = mergeBlockReferences(messageBlocks, missingIds)
      expect(merged).toEqual(['id1', 'id3', 'id2', 'id4'])
    })

    it('should handle empty message.blocks', () => {
      const messageBlocks: string[] = []
      const missingIds = ['id1', 'id2']

      const merged = mergeBlockReferences(messageBlocks, missingIds)
      expect(merged).toEqual(['id1', 'id2'])
    })
  })

  describe('MigrationResult type', () => {
    it('should have correct structure', () => {
      const result: MigrationResult = {
        totalMessages: 10,
        messagesFixed: 3,
        blockReferencesAdded: 7,
        errors: []
      }

      expect(result.messagesFixed).toBeLessThanOrEqual(result.totalMessages)
      expect(result.blockReferencesAdded).toBeGreaterThanOrEqual(result.messagesFixed)
    })

    it('should track errors correctly', () => {
      const result: MigrationResult = {
        totalMessages: 10,
        messagesFixed: 2,
        blockReferencesAdded: 5,
        errors: [{ sessionId: 'sess1', messageId: 'msg1', error: 'Parse error' }]
      }

      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].error).toBe('Parse error')
    })
  })
})
