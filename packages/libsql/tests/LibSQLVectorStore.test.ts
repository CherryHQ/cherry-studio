import { createClient } from '@libsql/client'
import type { BaseNode, MetadataFilters, VectorStoreQuery } from '@vectorstores/core'
import {
  FilterCondition,
  FilterOperator,
  type Metadata,
  MetadataMode,
  TextNode,
  VectorStoreQueryMode
} from '@vectorstores/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LibSQLVectorStore } from '../src/index.js'

describe('LibSQLVectorStore', () => {
  let store: LibSQLVectorStore
  let client: ReturnType<typeof createClient>

  beforeEach(() => {
    // Use in-memory database for testing
    client = createClient({
      url: ':memory:'
    })

    store = new LibSQLVectorStore({
      client,
      tableName: 'test_embeddings',
      dimensions: 2
    })
  })

  describe('Basic Operations', () => {
    it('should initialize with default configuration', () => {
      const defaultStore = new LibSQLVectorStore({
        clientConfig: { url: ':memory:' }
      })
      expect(defaultStore).toBeDefined()
      expect(defaultStore.storesText).toBe(true)
    })

    it('should default to in-memory client when no clientConfig or client provided', () => {
      const previousUrl = process.env.LIBSQL_URL
      const previousAuth = process.env.LIBSQL_AUTH_TOKEN
      delete process.env.LIBSQL_URL
      delete process.env.LIBSQL_AUTH_TOKEN

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const fallbackStore = new LibSQLVectorStore({})
      warnSpy.mockRestore()

      if (previousUrl) process.env.LIBSQL_URL = previousUrl
      else delete process.env.LIBSQL_URL

      if (previousAuth) process.env.LIBSQL_AUTH_TOKEN = previousAuth
      else delete process.env.LIBSQL_AUTH_TOKEN

      expect(fallbackStore.client()).toBeDefined()
    })

    it('should set and get collection', () => {
      store.setCollection('test-collection')
      expect(store.getCollection()).toBe('test-collection')
    })

    it('should get client connection', () => {
      const db = store.client()
      expect(db).toBeDefined()
    })
  })

  describe('Vector Operations', () => {
    beforeEach(async () => {
      // Ensure the database schema is set up
      // The schema is created lazily on first operation
    })

    it('should add nodes to vector store', async () => {
      const nodes: BaseNode<Metadata>[] = [
        new TextNode({
          embedding: [0.1, 0.2],
          metadata: { category: 'test', score: 1.0 }
        }),
        new TextNode({
          embedding: [0.3, 0.4],
          metadata: { category: 'example', score: 0.5 }
        })
      ]

      const ids = await store.add(nodes)
      expect(ids).toHaveLength(2)
      expect(ids[0]).toBeDefined()
      expect(ids[1]).toBeDefined()
    })

    it('should query vectors by similarity', async () => {
      // Add test data
      const nodes: BaseNode<Metadata>[] = [
        new TextNode({
          text: 'First document',
          embedding: [1.0, 0.0],
          metadata: { category: 'doc1' }
        }),
        new TextNode({
          text: 'Second document',
          embedding: [0.0, 1.0],
          metadata: { category: 'doc2' }
        })
      ]

      await store.add(nodes)

      // Query for similar vectors
      const query: VectorStoreQuery = {
        queryEmbedding: [0.9, 0.1],
        similarityTopK: 2,
        mode: VectorStoreQueryMode.DEFAULT
      }

      const result = await store.query(query)

      expect(result.nodes).toHaveLength(2)
      expect(result.ids).toHaveLength(2)
      expect(result.similarities).toHaveLength(2)

      // First result should be more similar (closer to [1.0, 0.0])
      expect(result.similarities[0]).toBeGreaterThan(result.similarities[1])
    })

    it('should handle empty add request', async () => {
      const ids = await store.add([])
      expect(ids).toEqual([])
    })

    it('should delete nodes by ID', async () => {
      const nodes: BaseNode<Metadata>[] = [
        new TextNode({
          id_: 'test-id-1',
          embedding: [0.1, 0.2],
          metadata: { category: 'test' }
        })
      ]

      await store.add(nodes)

      // Verify node exists by querying
      const queryBefore: VectorStoreQuery = {
        queryEmbedding: [0.1, 0.2],
        similarityTopK: 1,
        mode: VectorStoreQueryMode.DEFAULT
      }
      const resultBefore = await store.query(queryBefore)
      expect(resultBefore.nodes).toHaveLength(1)

      // Delete the node
      await store.delete('test-id-1')

      // Verify node is deleted
      const queryAfter: VectorStoreQuery = {
        queryEmbedding: [0.1, 0.2],
        similarityTopK: 1,
        mode: VectorStoreQueryMode.DEFAULT
      }
      const resultAfter = await store.query(queryAfter)
      expect(resultAfter.nodes).toHaveLength(0)
    })
  })

  describe('Metadata Filtering', () => {
    const filterCases: Array<{
      title: string
      filters: MetadataFilters
      queryEmbedding?: number[]
      expectedCount: number
      assert?: (nodes: BaseNode<Metadata>[]) => void
    }> = [
      {
        title: 'metadata equality',
        filters: {
          filters: [
            {
              key: 'category',
              value: 'technology',
              operator: FilterOperator.EQ
            }
          ]
        },
        expectedCount: 2,
        assert: (nodes) => nodes.forEach((node) => expect(node.metadata?.category).toBe('technology'))
      },
      {
        title: 'numeric comparison',
        filters: {
          filters: [{ key: 'rating', value: 4, operator: FilterOperator.GTE }]
        },
        expectedCount: 2,
        assert: (nodes) => nodes.forEach((node) => expect(node.metadata?.rating).toBeGreaterThanOrEqual(4))
      },
      {
        title: 'combined AND',
        filters: {
          filters: [
            {
              key: 'category',
              value: 'technology',
              operator: FilterOperator.EQ
            },
            { key: 'rating', value: 4, operator: FilterOperator.GTE }
          ],
          condition: FilterCondition.AND
        },
        expectedCount: 2,
        assert: (nodes) => {
          const ratings = nodes.map((node) => node.metadata?.rating)
          expect(ratings).toContain(4)
          expect(ratings).toContain(5)
          nodes.forEach((node) => expect(node.metadata?.category).toBe('technology'))
        }
      },
      {
        title: 'text match',
        filters: {
          filters: [{ key: 'tags', value: 'ai', operator: FilterOperator.TEXT_MATCH }]
        },
        queryEmbedding: [1.0, 0.0],
        expectedCount: 1,
        assert: (nodes) => {
          expect(nodes[0].metadata?.tags).toContain('ai')
        }
      }
    ]

    beforeEach(async () => {
      // Add test data with metadata
      const nodes: BaseNode<Metadata>[] = [
        new TextNode({
          text: 'Document about AI',
          embedding: [1.0, 0.0],
          metadata: { category: 'technology', rating: 5, tags: ['ai', 'ml'] }
        }),
        new TextNode({
          text: 'Document about cooking',
          embedding: [0.0, 1.0],
          metadata: {
            category: 'food',
            rating: 3,
            tags: ['cooking', 'recipes']
          }
        }),
        new TextNode({
          text: 'Another tech document',
          embedding: [0.5, 0.5],
          metadata: {
            category: 'technology',
            rating: 4,
            tags: ['programming']
          }
        })
      ]

      await store.add(nodes)
    })

    filterCases.forEach(({ title, filters, queryEmbedding, expectedCount, assert }) => {
      it(`should filter by ${title}`, async () => {
        const query: VectorStoreQuery = {
          queryEmbedding: queryEmbedding ?? [0.5, 0.5],
          similarityTopK: 5,
          filters,
          mode: VectorStoreQueryMode.DEFAULT
        }

        const result = await store.query(query)
        expect(result.nodes).toHaveLength(expectedCount)
        assert?.(result.nodes as BaseNode<Metadata>[])
      })
    })
  })

  describe('Collection Management', () => {
    beforeEach(async () => {
      // Add data to default collection
      const nodes: BaseNode<Metadata>[] = [
        new TextNode({
          embedding: [0.1, 0.2],
          metadata: { collection: 'default' }
        })
      ]

      await store.add(nodes)
    })

    it('should clear collection', async () => {
      // Verify data exists
      const query: VectorStoreQuery = {
        queryEmbedding: [0.1, 0.2],
        similarityTopK: 1,
        mode: VectorStoreQueryMode.DEFAULT
      }
      let result = await store.query(query)
      expect(result.nodes).toHaveLength(1)

      // Clear collection
      await store.clearCollection()

      // Verify data is gone
      result = await store.query(query)
      expect(result.nodes).toHaveLength(0)
    })

    it('should isolate data by collection', async () => {
      const originalCollection = store.getCollection()
      // Add data to different collection
      store.setCollection('test-collection')

      const newNodes: BaseNode<Metadata>[] = [
        new TextNode({
          embedding: [0.3, 0.4],
          metadata: { collection: 'test' }
        })
      ]

      await store.add(newNodes)

      // Query in test-collection should find data
      let query: VectorStoreQuery = {
        queryEmbedding: [0.3, 0.4],
        similarityTopK: 1,
        mode: VectorStoreQueryMode.DEFAULT
      }
      let result = await store.query(query)
      expect(result.nodes).toHaveLength(1)

      // Switch back to default collection and query
      store.setCollection(originalCollection)
      query = {
        queryEmbedding: [0.1, 0.2],
        similarityTopK: 1,
        mode: VectorStoreQueryMode.DEFAULT
      }
      result = await store.query(query)
      expect(result.nodes).toHaveLength(1)
    })
  })

  describe('Utility Functions', () => {
    it('should convert to Float32Array', async () => {
      const { toFloat32Array } = await import('../src/utils.js')
      const array = [0.1, 0.2, 0.3]
      const result = toFloat32Array(array)
      expect(result).toBeInstanceOf(Float32Array)
      Array.from(result).forEach((value, idx) => {
        expect(value).toBeCloseTo(array[idx]!, 6)
      })
    })

    it('should convert from Float32Array', async () => {
      const { fromFloat32Array } = await import('../src/utils.js')
      const float32Array = new Float32Array([0.1, 0.2, 0.3])
      const result = fromFloat32Array(float32Array)
      result.forEach((value, idx) => {
        expect(value).toBeCloseTo([0.1, 0.2, 0.3][idx]!, 6)
      })
    })
  })

  describe('Error Handling', () => {
    it('should handle missing embeddings gracefully', async () => {
      const nodeWithoutEmbedding = new TextNode({
        text: 'Test node',
        metadata: { category: 'test' }
      })

      // Should handle nodes without embeddings
      const ids = await store.add([nodeWithoutEmbedding])
      expect(ids).toHaveLength(1)
    })

    it('should handle query with null embedding', async () => {
      const query: VectorStoreQuery = {
        queryEmbedding: undefined,
        similarityTopK: 1,
        mode: VectorStoreQueryMode.DEFAULT
      }

      // Should handle gracefully, possibly returning empty results
      const result = await store.query(query)
      expect(result).toBeDefined()
      expect(result.nodes).toBeDefined()
      expect(result.similarities).toBeDefined()
      expect(result.ids).toBeDefined()
    })
  })

  describe('Configuration Options', () => {
    it('should work with pre-configured client', async () => {
      const customClient = createClient({ url: ':memory:' })
      const customStore = new LibSQLVectorStore({
        client: customClient,
        tableName: 'custom_table',
        dimensions: 4
      })

      expect(customStore).toBeDefined()

      const nodes: BaseNode<Metadata>[] = [
        new TextNode({
          embedding: [0.1, 0.2, 0.3, 0.4],
          metadata: { custom: true }
        })
      ]

      const ids = await customStore.add(nodes)
      expect(ids).toHaveLength(1)
    })

    it('should work with client configuration', async () => {
      const configStore = new LibSQLVectorStore({
        clientConfig: {
          url: ':memory:'
        },
        tableName: 'config_table',
        dimensions: 3
      })

      expect(configStore).toBeDefined()

      const db = configStore.client()
      expect(db).toBeDefined()
    })
  })

  describe('Query Modes', () => {
    beforeEach(async () => {
      // Add test data with text content for FTS
      const nodes: BaseNode<Metadata>[] = [
        new TextNode({
          text: 'Machine learning and artificial intelligence are transforming technology',
          embedding: [1.0, 0.0],
          metadata: { category: 'technology', topic: 'ai' }
        }),
        new TextNode({
          text: 'Cooking recipes and food preparation techniques',
          embedding: [0.0, 1.0],
          metadata: { category: 'food', topic: 'cooking' }
        }),
        new TextNode({
          text: 'Deep learning neural networks for artificial intelligence',
          embedding: [0.8, 0.2],
          metadata: { category: 'technology', topic: 'ai' }
        })
      ]

      await store.add(nodes)
    })

    it('should query using default mode (vector search)', async () => {
      const query: VectorStoreQuery = {
        queryEmbedding: [0.9, 0.1],
        similarityTopK: 2,
        mode: VectorStoreQueryMode.DEFAULT
      }

      const result = await store.query(query)

      expect(result.nodes).toHaveLength(2)
      expect(result.similarities).toHaveLength(2)
      expect(result.ids).toHaveLength(2)
      // First result should be more similar (closer to [1.0, 0.0])
      expect(result.similarities[0]).toBeGreaterThan(result.similarities[1])
    })

    it('should query using bm25 mode (full-text search)', async () => {
      const query: VectorStoreQuery = {
        queryStr: 'artificial intelligence',
        similarityTopK: 2,
        mode: 'bm25' as VectorStoreQueryMode
      }

      const result = await store.query(query)

      expect(result.nodes).toBeDefined()
      expect(result.similarities).toBeDefined()
      expect(result.ids).toBeDefined()
      // Should find documents containing "artificial intelligence"
      if (result.nodes && result.nodes.length > 0) {
        result.nodes.forEach((node) => {
          const text = node.getContent(MetadataMode.NONE).toLowerCase()
          expect(text.includes('artificial') || text.includes('intelligence')).toBe(true)
        })
      }
    })

    it('should throw error for bm25 mode without queryStr', async () => {
      const query: VectorStoreQuery = {
        queryEmbedding: [0.5, 0.5],
        similarityTopK: 2,
        mode: 'bm25' as VectorStoreQueryMode
      }

      await expect(store.query(query)).rejects.toThrow('queryStr is required for BM25 mode')
    })

    it('should query using hybrid mode (vector + FTS)', async () => {
      const query: VectorStoreQuery = {
        queryEmbedding: [0.9, 0.1],
        queryStr: 'artificial intelligence',
        similarityTopK: 2,
        mode: 'hybrid' as VectorStoreQueryMode,
        alpha: 0.5
      }

      const result = await store.query(query)

      expect(result.nodes).toBeDefined()
      expect(result.similarities).toBeDefined()
      expect(result.ids).toBeDefined()
    })

    it('should throw error for hybrid mode without queryEmbedding', async () => {
      const query: VectorStoreQuery = {
        queryStr: 'artificial intelligence',
        similarityTopK: 2,
        mode: 'hybrid' as VectorStoreQueryMode
      }

      await expect(store.query(query)).rejects.toThrow('queryEmbedding is required for HYBRID mode')
    })

    it('should throw error for hybrid mode without queryStr', async () => {
      const query: VectorStoreQuery = {
        queryEmbedding: [0.5, 0.5],
        similarityTopK: 2,
        mode: 'hybrid' as VectorStoreQueryMode
      }

      await expect(store.query(query)).rejects.toThrow('queryStr is required for HYBRID mode')
    })

    it('should fallback to vector search for unknown query mode', async () => {
      const query: VectorStoreQuery = {
        queryEmbedding: [0.5, 0.5],
        similarityTopK: 2,
        mode: 'unknown_mode' as VectorStoreQueryMode
      }

      const result = await store.query(query)

      // Should fallback to vector search and return results
      expect(result.nodes).toBeDefined()
      expect(result.similarities).toBeDefined()
      expect(result.ids).toBeDefined()
    })
  })

  describe('exists', () => {
    it('should return true for existing document', async () => {
      const nodes: BaseNode<Metadata>[] = [
        new TextNode({
          id_: 'doc-123',
          embedding: [0.1, 0.2],
          metadata: { ref_doc_id: 'ref-doc-1' }
        })
      ]

      await store.add(nodes)

      const exists = await store.exists('ref-doc-1')
      expect(exists).toBe(true)
    })

    it('should return false for non-existing document', async () => {
      const exists = await store.exists('non-existent-ref')
      expect(exists).toBe(false)
    })

    it('should respect collection when checking existence', async () => {
      store.setCollection('collection-a')

      const nodes: BaseNode<Metadata>[] = [
        new TextNode({
          embedding: [0.1, 0.2],
          metadata: { ref_doc_id: 'ref-doc-collection' }
        })
      ]

      await store.add(nodes)

      // Should find in same collection
      expect(await store.exists('ref-doc-collection')).toBe(true)

      // Should not find in different collection
      store.setCollection('collection-b')
      expect(await store.exists('ref-doc-collection')).toBe(false)
    })
  })
})
