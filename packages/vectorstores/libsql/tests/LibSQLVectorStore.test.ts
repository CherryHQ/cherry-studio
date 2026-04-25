import { createClient } from '@libsql/client'
import type { BaseNode, MetadataFilters, VectorStoreQuery } from '@vectorstores/core'
import {
  FilterCondition,
  FilterOperator,
  type Metadata,
  MetadataMode,
  NodeRelationship,
  TextNode,
  VectorStoreQueryMode
} from '@vectorstores/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LibSQLVectorStore } from '../src/LibSQLVectorStore.js'

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

    it('should reject nodes with missing embeddings instead of writing zero vectors', async () => {
      const node = new TextNode({
        id_: 'chunk-missing-embedding',
        text: 'Document chunk without embedding',
        metadata: { category: 'invalid' }
      })

      await expect(store.add([node])).rejects.toThrow('Missing embedding for node chunk-missing-embedding')

      const rows = await client.execute(
        "SELECT COUNT(*) as count FROM test_embeddings WHERE id = 'chunk-missing-embedding'"
      )
      expect(Number(rows.rows[0]?.count ?? 0)).toBe(0)
    })

    it('should reject nodes with mismatched embedding dimensions', async () => {
      const node = new TextNode({
        id_: 'chunk-bad-dimensions',
        text: 'Document chunk with mismatched embedding dimensions',
        embedding: [0.1, 0.2, 0.3],
        metadata: { category: 'invalid' }
      })

      await expect(store.add([node])).rejects.toThrow(
        'Embedding dimension mismatch for node chunk-bad-dimensions: expected 2, got 3'
      )

      const rows = await client.execute(
        "SELECT COUNT(*) as count FROM test_embeddings WHERE id = 'chunk-bad-dimensions'"
      )
      expect(Number(rows.rows[0]?.count ?? 0)).toBe(0)
    })

    it('should persist external_id from sourceNode.nodeId', async () => {
      const node = new TextNode({
        id_: 'chunk-1',
        text: 'Document chunk',
        embedding: [0.1, 0.2],
        metadata: { category: 'test' },
        relationships: {
          [NodeRelationship.SOURCE]: {
            nodeId: 'item-1',
            metadata: {}
          }
        }
      })

      await store.add([node])

      const rows = await client.execute('SELECT id, external_id, collection FROM test_embeddings')
      expect(rows.rows).toHaveLength(1)
      expect(rows.rows[0]).toMatchObject({
        id: 'chunk-1',
        external_id: 'item-1',
        collection: store.getCollection()
      })
    })

    it('should fall back to node.id_ when sourceNode.nodeId is missing', async () => {
      const node = new TextNode({
        id_: 'chunk-2',
        text: 'Document chunk without source node',
        embedding: [0.3, 0.4],
        metadata: { category: 'fallback' }
      })

      await store.add([node])

      const rows = await client.execute("SELECT id, external_id FROM test_embeddings WHERE id = 'chunk-2'")
      expect(rows.rows).toHaveLength(1)
      expect(rows.rows[0]).toMatchObject({
        id: 'chunk-2',
        external_id: 'chunk-2'
      })
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

    it('should expose itemId from external_id in query results', async () => {
      const node = new TextNode({
        id_: 'chunk-knowledge-1',
        text: 'Knowledge document',
        embedding: [1.0, 0.0],
        metadata: { source: '/tmp/doc.md' },
        relationships: {
          [NodeRelationship.SOURCE]: {
            nodeId: 'item-knowledge-1',
            metadata: {}
          }
        }
      })

      await store.add([node])

      const result = await store.query({
        queryEmbedding: [1.0, 0.0],
        similarityTopK: 1,
        mode: VectorStoreQueryMode.DEFAULT
      })

      expect(result.nodes).toHaveLength(1)
      expect(result.nodes?.[0]?.metadata).toMatchObject({
        source: '/tmp/doc.md',
        itemId: 'item-knowledge-1'
      })
    })

    it('should tolerate invalid metadata JSON in vector query results', async () => {
      await store.add([
        new TextNode({
          id_: 'chunk-invalid-metadata-vector',
          text: 'Knowledge document',
          embedding: [1.0, 0.0],
          relationships: {
            [NodeRelationship.SOURCE]: {
              nodeId: 'item-invalid-metadata-vector',
              metadata: {}
            }
          }
        })
      ])

      await client.execute({
        sql: 'UPDATE test_embeddings SET metadata = ? WHERE id = ?',
        args: ['{"itemId":', 'chunk-invalid-metadata-vector']
      })

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const result = await store.query({
        queryEmbedding: [1.0, 0.0],
        similarityTopK: 1,
        mode: VectorStoreQueryMode.DEFAULT
      })

      expect(result.nodes).toHaveLength(1)
      expect(result.nodes?.[0]?.metadata).toMatchObject({
        itemId: 'item-invalid-metadata-vector'
      })
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to parse metadata JSON for row chunk-invalid-metadata-vector',
        expect.any(Error)
      )
      warnSpy.mockRestore()
    })

    it('should tolerate invalid metadata JSON in bm25 query results', async () => {
      await store.add([
        new TextNode({
          id_: 'chunk-invalid-metadata-bm25',
          text: 'searchable bm25 document',
          embedding: [1.0, 0.0],
          relationships: {
            [NodeRelationship.SOURCE]: {
              nodeId: 'item-invalid-metadata-bm25',
              metadata: {}
            }
          }
        })
      ])

      await client.execute({
        sql: 'UPDATE test_embeddings SET metadata = ? WHERE id = ?',
        args: ['{"itemId":', 'chunk-invalid-metadata-bm25']
      })

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const result = await store.query({
        queryStr: 'searchable',
        similarityTopK: 1,
        mode: VectorStoreQueryMode.BM25
      })

      expect(result.nodes).toHaveLength(1)
      expect(result.nodes?.[0]?.metadata).toMatchObject({
        itemId: 'item-invalid-metadata-bm25'
      })
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to parse metadata JSON for row chunk-invalid-metadata-bm25',
        expect.any(Error)
      )
      warnSpy.mockRestore()
    })

    it('should preserve the original cause when bm25 execution fails', async () => {
      await store.add([
        new TextNode({
          id_: 'chunk-bm25-failure',
          text: 'searchable document',
          embedding: [1.0, 0.0],
          metadata: { category: 'test' }
        })
      ])

      const originalExecute = client.execute.bind(client)
      const executeSpy = vi.spyOn(client, 'execute').mockImplementation(async (statement: any) => {
        const sql = typeof statement === 'string' ? statement : statement.sql
        if (typeof sql === 'string' && sql.includes('bm25(')) {
          throw new Error('fts execution failed')
        }

        return await originalExecute(statement)
      })

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      try {
        await store.query({
          queryStr: 'searchable',
          similarityTopK: 1,
          mode: VectorStoreQueryMode.BM25
        })
        throw new Error('Expected BM25 query to fail')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toBe('BM25 search failed')
        expect((error as Error & { cause?: unknown }).cause).toBeInstanceOf(Error)
        expect(((error as Error & { cause?: Error }).cause as Error).message).toBe('fts execution failed')
      }

      expect(warnSpy).toHaveBeenCalledWith('FTS5 search failed:', expect.any(Error))
      warnSpy.mockRestore()
      executeSpy.mockRestore()
    })

    it('should handle empty add request', async () => {
      const ids = await store.add([])
      expect(ids).toEqual([])
    })

    it('should throw when SQL arguments would contain invalid nullish values', async () => {
      const invalidNode = {
        id_: '',
        metadata: { category: 'test' },
        sourceNode: undefined,
        getEmbedding: () => [0.1, 0.2],
        getContent: () => 'Document chunk'
      } as unknown as BaseNode<Metadata>

      await expect(store.add([invalidNode])).rejects.toThrow('Invalid libSQL argument at index 0: null')
    })

    it('should fail initialization when FTS schema creation fails', async () => {
      const originalExecute = client.execute.bind(client)
      const executeSpy = vi.spyOn(client, 'execute').mockImplementation(async (statement: any) => {
        const sql = typeof statement === 'string' ? statement : statement.sql
        if (typeof sql === 'string' && sql.includes('CREATE VIRTUAL TABLE IF NOT EXISTS test_embeddings_fts')) {
          throw new Error('fts creation failed')
        }

        return await originalExecute(statement)
      })

      const node = new TextNode({
        id_: 'chunk-fts-fail',
        text: 'Document chunk',
        embedding: [0.1, 0.2],
        metadata: { category: 'test' }
      })

      await expect(store.add([node])).rejects.toThrow('fts creation failed')
      executeSpy.mockRestore()
    })

    it('should only run schema initialization once for concurrent callers', async () => {
      let checkSchemaCalls = 0
      let resolveInitialization!: () => void
      const initializationBarrier = new Promise<void>((resolve) => {
        resolveInitialization = resolve
      })
      const originalCheckSchema = (store as any).checkSchema.bind(store) as (clientArg: unknown) => Promise<void>

      const checkSchemaSpy = vi.spyOn(store as any, 'checkSchema').mockImplementation(async (clientArg: unknown) => {
        checkSchemaCalls += 1
        await initializationBarrier
        return await originalCheckSchema(clientArg)
      })

      const firstAddPromise = store.add([
        new TextNode({
          id_: 'chunk-concurrent-1',
          text: 'Concurrent document 1',
          embedding: [0.1, 0.2],
          metadata: { category: 'first' }
        })
      ])

      const secondAddPromise = store.add([
        new TextNode({
          id_: 'chunk-concurrent-2',
          text: 'Concurrent document 2',
          embedding: [0.2, 0.1],
          metadata: { category: 'second' }
        })
      ])

      await vi.waitFor(() => {
        expect(checkSchemaCalls).toBe(1)
      })

      resolveInitialization()

      await expect(Promise.all([firstAddPromise, secondAddPromise])).resolves.toEqual([
        ['chunk-concurrent-1'],
        ['chunk-concurrent-2']
      ])

      expect(checkSchemaCalls).toBe(1)
      checkSchemaSpy.mockRestore()
    })

    it('should rebuild FTS only when the FTS table is first created', async () => {
      let rebuildCount = 0
      const originalExecute = client.execute.bind(client)
      const executeSpy = vi.spyOn(client, 'execute').mockImplementation(async (statement: any) => {
        const sql = typeof statement === 'string' ? statement : statement.sql
        if (typeof sql === 'string' && sql.includes("VALUES ('rebuild')")) {
          rebuildCount += 1
        }

        return await originalExecute(statement)
      })

      await store.add([
        new TextNode({
          id_: 'chunk-first-init',
          text: 'First document',
          embedding: [0.1, 0.2],
          metadata: { category: 'first' }
        })
      ])

      const secondStore = new LibSQLVectorStore({
        client,
        tableName: 'test_embeddings',
        dimensions: 2
      })

      await secondStore.add([
        new TextNode({
          id_: 'chunk-second-init',
          text: 'Second document',
          embedding: [0.2, 0.1],
          metadata: { category: 'second' }
        })
      ])

      expect(rebuildCount).toBe(1)
      executeSpy.mockRestore()
    })

    it('should delete all nodes by external_id', async () => {
      const nodeA = new TextNode({
        id_: 'chunk-1',
        text: 'Document chunk A',
        embedding: [0.1, 0.2],
        metadata: { category: 'test' },
        relationships: {
          [NodeRelationship.SOURCE]: {
            nodeId: 'item-1',
            metadata: {}
          }
        }
      })

      const nodeB = new TextNode({
        id_: 'chunk-2',
        text: 'Document chunk B',
        embedding: [0.1, 0.2],
        metadata: { category: 'test' },
        relationships: {
          [NodeRelationship.SOURCE]: {
            nodeId: 'item-1',
            metadata: {}
          }
        }
      })

      await store.add([nodeA, nodeB])

      const queryBefore: VectorStoreQuery = {
        queryEmbedding: [0.1, 0.2],
        similarityTopK: 2,
        mode: VectorStoreQueryMode.DEFAULT
      }
      const resultBefore = await store.query(queryBefore)
      expect(resultBefore.nodes).toHaveLength(2)

      await store.delete('item-1')

      const queryAfter: VectorStoreQuery = {
        queryEmbedding: [0.1, 0.2],
        similarityTopK: 2,
        mode: VectorStoreQueryMode.DEFAULT
      }
      const resultAfter = await store.query(queryAfter)
      expect(resultAfter.nodes).toHaveLength(0)
    })

    it('should scope delete by collection', async () => {
      const otherCollectionStore = new LibSQLVectorStore({
        client,
        tableName: 'test_embeddings',
        dimensions: 2,
        collection: 'other'
      })

      const nodeDefault = new TextNode({
        id_: 'chunk-default',
        text: 'Default collection chunk',
        embedding: [0.2, 0.3],
        metadata: { category: 'scope' },
        relationships: {
          [NodeRelationship.SOURCE]: {
            nodeId: 'item-shared',
            metadata: {}
          }
        }
      })

      const nodeOther = new TextNode({
        id_: 'chunk-other',
        text: 'Other collection chunk',
        embedding: [0.2, 0.3],
        metadata: { category: 'scope' },
        relationships: {
          [NodeRelationship.SOURCE]: {
            nodeId: 'item-shared',
            metadata: {}
          }
        }
      })

      await store.add([nodeDefault])
      await otherCollectionStore.add([nodeOther])

      await store.delete('item-shared')

      const rows = await client.execute(
        "SELECT id, external_id, collection FROM test_embeddings WHERE external_id = 'item-shared' ORDER BY id"
      )
      expect(rows.rows).toHaveLength(1)
      expect(rows.rows[0]).toMatchObject({
        id: 'chunk-other',
        external_id: 'item-shared',
        collection: 'other'
      })
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

    it('should reject invalid metadata filter keys', async () => {
      const query: VectorStoreQuery = {
        queryEmbedding: [0.5, 0.5],
        similarityTopK: 5,
        filters: {
          filters: [
            {
              key: "category') = 'technology' OR 1=1 --",
              value: 'technology',
              operator: FilterOperator.EQ
            }
          ]
        },
        mode: VectorStoreQueryMode.DEFAULT
      }

      await expect(store.query(query)).rejects.toThrow(
        "Invalid metadata filter key: category') = 'technology' OR 1=1 --"
      )
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
        expect(value).toBeCloseTo(array[idx], 6)
      })
    })

    it('should convert from Float32Array', async () => {
      const { fromFloat32Array } = await import('../src/utils.js')
      const float32Array = new Float32Array([0.1, 0.2, 0.3])
      const result = fromFloat32Array(float32Array)
      result.forEach((value, idx) => {
        expect(value).toBeCloseTo([0.1, 0.2, 0.3][idx], 6)
      })
    })

    it('should throw when deserializeEmbedding receives an unsupported payload type', () => {
      expect(() => (store as any).deserializeEmbedding('not-an-embedding')).toThrow(
        'Unexpected embedding payload type in LibSQLVectorStore.deserializeEmbedding'
      )
    })

    it('should throw when deserializeEmbedding receives a missing payload', () => {
      expect(() => (store as any).deserializeEmbedding(null)).toThrow(
        'Missing embedding payload in LibSQLVectorStore.deserializeEmbedding'
      )
    })
  })

  describe('Error Handling', () => {
    it('should reject nodes with missing embeddings', async () => {
      const nodeWithoutEmbedding = new TextNode({
        text: 'Test node',
        metadata: { category: 'test' }
      })

      await expect(store.add([nodeWithoutEmbedding])).rejects.toThrow('Missing embedding for node')
    })

    it('should reject query with null embedding', async () => {
      const query: VectorStoreQuery = {
        queryEmbedding: undefined,
        similarityTopK: 1,
        mode: VectorStoreQueryMode.DEFAULT
      }

      await expect(store.query(query)).rejects.toThrow('queryEmbedding is required for vector search')
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
      const nodes = result.nodes ?? []

      expect(nodes).toHaveLength(2)
      expect(result.similarities).toHaveLength(2)
      expect(result.ids).toHaveLength(2)
      nodes.forEach((node) => {
        const text = node.getContent(MetadataMode.NONE).toLowerCase()
        expect(text.includes('artificial') || text.includes('intelligence')).toBe(true)
      })
    })

    it('should query bm25 mode with punctuation as ordinary user text', async () => {
      await store.add([
        new TextNode({
          text: 'DeepSeek-V3.2 release notes mention node.js, README.md, and C++ usage examples',
          embedding: [0.7, 0.3],
          metadata: { category: 'release' }
        })
      ])

      const queries = ['DeepSeek-V3.2', 'README.md', 'node.js', 'C++', 'DeepSeek "V3.2"']

      for (const queryStr of queries) {
        const result = await store.query({
          queryStr,
          similarityTopK: 3,
          mode: 'bm25' as VectorStoreQueryMode
        })

        expect(result.nodes?.length ?? 0).toBeGreaterThan(0)
      }
    })

    it('should return empty bm25 results for punctuation-only user text', async () => {
      const result = await store.query({
        queryStr: '...',
        similarityTopK: 3,
        mode: 'bm25' as VectorStoreQueryMode
      })

      expect(result).toEqual({
        nodes: [],
        similarities: [],
        ids: []
      })
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
      const nodes = result.nodes ?? []

      expect(nodes).toHaveLength(2)
      expect(result.similarities).toHaveLength(2)
      expect(result.ids).toHaveLength(2)
      nodes.forEach((node) => {
        const text = node.getContent(MetadataMode.NONE).toLowerCase()
        expect(text.includes('artificial') || text.includes('intelligence') || text.includes('learning')).toBe(true)
      })
    })

    it('should query hybrid mode with punctuation as ordinary user text', async () => {
      await store.add([
        new TextNode({
          text: 'DeepSeek-V3.2 release notes for hybrid retrieval',
          embedding: [0.9, 0.1],
          metadata: { category: 'release' }
        })
      ])

      const result = await store.query({
        queryEmbedding: [0.9, 0.1],
        queryStr: 'DeepSeek-V3.2',
        similarityTopK: 2,
        mode: 'hybrid' as VectorStoreQueryMode
      })

      expect(result.nodes?.length ?? 0).toBeGreaterThan(0)
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

    it('should update bm25 index after upsert', async () => {
      const node = new TextNode({
        id_: 'upsert-doc',
        text: 'legacy keyword content',
        embedding: [0.6, 0.4],
        metadata: { category: 'technology' }
      })

      await store.add([node])

      let result = await store.query({
        queryStr: 'legacy',
        similarityTopK: 5,
        mode: 'bm25' as VectorStoreQueryMode
      })
      expect(result.ids).toContain('upsert-doc')

      await store.add([
        new TextNode({
          id_: 'upsert-doc',
          text: 'fresh keyword content',
          embedding: [0.6, 0.4],
          metadata: { category: 'technology' }
        })
      ])

      result = await store.query({
        queryStr: 'legacy',
        similarityTopK: 5,
        mode: 'bm25' as VectorStoreQueryMode
      })
      expect(result.ids).not.toContain('upsert-doc')

      result = await store.query({
        queryStr: 'fresh',
        similarityTopK: 5,
        mode: 'bm25' as VectorStoreQueryMode
      })
      expect(result.ids).toContain('upsert-doc')
    })

    it('should remove deleted documents from bm25 index', async () => {
      const node = new TextNode({
        id_: 'delete-doc',
        text: 'remove me from bm25',
        embedding: [0.4, 0.6],
        metadata: { category: 'technology' },
        relationships: {
          [NodeRelationship.SOURCE]: {
            nodeId: 'item-delete',
            metadata: {}
          }
        }
      })

      await store.add([node])

      let result = await store.query({
        queryStr: 'remove',
        similarityTopK: 5,
        mode: 'bm25' as VectorStoreQueryMode
      })
      expect(result.ids).toContain('delete-doc')

      await store.delete('item-delete')

      result = await store.query({
        queryStr: 'remove',
        similarityTopK: 5,
        mode: 'bm25' as VectorStoreQueryMode
      })
      expect(result.ids).not.toContain('delete-doc')
    })
  })

  describe('exists', () => {
    it('should return true for existing external_id', async () => {
      const nodes: BaseNode<Metadata>[] = [
        new TextNode({
          id_: 'doc-123',
          embedding: [0.1, 0.2],
          metadata: { category: 'exists' },
          relationships: {
            [NodeRelationship.SOURCE]: {
              nodeId: 'item-1',
              metadata: {}
            }
          }
        })
      ]

      await store.add(nodes)

      const exists = await store.exists('item-1')
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
          metadata: { category: 'exists' },
          relationships: {
            [NodeRelationship.SOURCE]: {
              nodeId: 'item-collection',
              metadata: {}
            }
          }
        })
      ]

      await store.add(nodes)

      // Should find in same collection
      expect(await store.exists('item-collection')).toBe(true)

      // Should not find in different collection
      store.setCollection('collection-b')
      expect(await store.exists('item-collection')).toBe(false)
    })
  })

  describe('listByExternalId', () => {
    it('should list documents by external_id in chunk order without embeddings', async () => {
      await store.add([
        new TextNode({
          id_: 'chunk-2',
          text: 'second chunk',
          embedding: [0.1, 0.2],
          metadata: { itemId: 'item-1', chunkIndex: 1, tokenCount: 2 },
          relationships: {
            [NodeRelationship.SOURCE]: {
              nodeId: 'item-1',
              metadata: {}
            }
          }
        }),
        new TextNode({
          id_: 'chunk-1',
          text: 'first chunk',
          embedding: [0.3, 0.4],
          metadata: { itemId: 'item-1', chunkIndex: 0, tokenCount: 2 },
          relationships: {
            [NodeRelationship.SOURCE]: {
              nodeId: 'item-1',
              metadata: {}
            }
          }
        }),
        new TextNode({
          id_: 'other-chunk',
          text: 'other item chunk',
          embedding: [0.5, 0.6],
          metadata: { itemId: 'item-2', chunkIndex: 0, tokenCount: 3 },
          relationships: {
            [NodeRelationship.SOURCE]: {
              nodeId: 'item-2',
              metadata: {}
            }
          }
        })
      ])

      const chunks = await store.listByExternalId('item-1')

      expect(chunks.map((chunk) => chunk.id_)).toEqual(['chunk-1', 'chunk-2'])
      expect(chunks.map((chunk) => chunk.getContent(MetadataMode.NONE))).toEqual(['first chunk', 'second chunk'])
      expect(chunks.map((chunk) => chunk.metadata.chunkIndex)).toEqual([0, 1])
      expect(() => chunks[0]?.getEmbedding()).toThrow('Embedding not set')
    })

    it('should respect collection when listing documents', async () => {
      store.setCollection('collection-a')
      await store.add([
        new TextNode({
          id_: 'collection-a-chunk',
          text: 'collection a chunk',
          embedding: [0.1, 0.2],
          metadata: { itemId: 'item-1', chunkIndex: 0, tokenCount: 3 },
          relationships: {
            [NodeRelationship.SOURCE]: {
              nodeId: 'item-1',
              metadata: {}
            }
          }
        })
      ])

      store.setCollection('collection-b')
      await store.add([
        new TextNode({
          id_: 'collection-b-chunk',
          text: 'collection b chunk',
          embedding: [0.3, 0.4],
          metadata: { itemId: 'item-1', chunkIndex: 0, tokenCount: 3 },
          relationships: {
            [NodeRelationship.SOURCE]: {
              nodeId: 'item-1',
              metadata: {}
            }
          }
        })
      ])

      const chunks = await store.listByExternalId('item-1')

      expect(chunks.map((chunk) => chunk.id_)).toEqual(['collection-b-chunk'])
    })
  })
})
