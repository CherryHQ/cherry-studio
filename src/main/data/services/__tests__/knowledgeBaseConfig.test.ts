import { describe, expect, it } from 'vitest'

import {
  normalizeKnowledgeBaseConfig,
  normalizeKnowledgeBaseConfigDependencies,
  validateKnowledgeBaseConfig
} from '../knowledgeBaseConfig'

describe('knowledgeBaseConfig', () => {
  describe('normalizeKnowledgeBaseConfig', () => {
    it('should clear invalid tuning fields for migration inputs', () => {
      expect(
        normalizeKnowledgeBaseConfig({
          chunkSize: 200,
          chunkOverlap: 200,
          threshold: 2,
          documentCount: 0,
          searchMode: 'default' as const,
          hybridAlpha: 0.6
        })
      ).toEqual({
        chunkSize: 200,
        chunkOverlap: undefined,
        threshold: undefined,
        documentCount: undefined,
        searchMode: 'default',
        hybridAlpha: undefined
      })
    })
  })

  describe('normalizeKnowledgeBaseConfigDependencies', () => {
    it('should clear stale dependent fields after primary config changes', () => {
      expect(
        normalizeKnowledgeBaseConfigDependencies({
          chunkSize: 100,
          chunkOverlap: 120,
          searchMode: 'default' as const,
          hybridAlpha: 0.6
        })
      ).toEqual({
        chunkSize: 100,
        chunkOverlap: undefined,
        searchMode: 'default',
        hybridAlpha: undefined
      })
    })
  })

  describe('validateKnowledgeBaseConfig', () => {
    it('should return field errors for invalid runtime config combinations', () => {
      expect(
        validateKnowledgeBaseConfig({
          chunkSize: null,
          chunkOverlap: 64,
          threshold: 1.5,
          documentCount: 0,
          searchMode: 'default',
          hybridAlpha: 2
        })
      ).toEqual({
        chunkOverlap: ['Chunk overlap requires chunk size'],
        threshold: ['Threshold must be between 0 and 1'],
        documentCount: ['Document count must be greater than 0'],
        hybridAlpha: ['Hybrid alpha must be between 0 and 1']
      })
    })

    it('should reject hybridAlpha when searchMode is not hybrid', () => {
      expect(
        validateKnowledgeBaseConfig({
          searchMode: 'bm25',
          hybridAlpha: 0.7
        })
      ).toEqual({
        hybridAlpha: ['Hybrid alpha requires hybrid search mode']
      })
    })

    it('should accept valid config', () => {
      expect(
        validateKnowledgeBaseConfig({
          chunkSize: 512,
          chunkOverlap: 64,
          threshold: 0.5,
          documentCount: 5,
          searchMode: 'hybrid',
          hybridAlpha: 0.7
        })
      ).toEqual({})
    })
  })
})
