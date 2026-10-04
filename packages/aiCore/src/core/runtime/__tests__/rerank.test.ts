import type { RerankingModelV4 } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import { RuntimeExecutor } from '../executor'
import type { RuntimeProviderCallEvent } from '../types'

describe('RuntimeExecutor.rerank', () => {
  it.each([false, true])(
    'preserves document identity, ranking and per-call observations (direct model: %s)',
    async (direct) => {
      const events: RuntimeProviderCallEvent[] = []
      let received: Parameters<RerankingModelV4['doRerank']>[0] | undefined
      const model: RerankingModelV4 = {
        specificationVersion: 'v4',
        provider: 'test.rerank',
        modelId: 'reranker',
        doRerank: async (options) => {
          received = options
          return {
            ranking: [
              { index: 1, relevanceScore: 0.9 },
              { index: 0, relevanceScore: 0.2 }
            ],
            response: { timestamp: new Date(0), modelId: 'reranker', headers: {} }
          }
        }
      }
      const executor = RuntimeExecutor.create(
        'openai',
        {
          specificationVersion: 'v4',
          embeddingModel: () => {
            throw new Error('Wrong model route')
          },
          imageModel: () => {
            throw new Error('Wrong model route')
          },
          languageModel: () => {
            throw new Error('Wrong model route')
          },
          rerankingModel: (id) => {
            expect(id).toBe('reranker')
            return model
          }
        },
        {}
      )
      const result = await executor.rerank({
        model: direct ? model : 'reranker',
        query: 'fruit',
        documents: ['stone', 'cherry'],
        topN: 2,
        onProviderCall: (event) => {
          events.push(event)
          throw new Error('observer failure must not change the result')
        }
      })
      expect(received).toMatchObject({
        query: 'fruit',
        documents: { type: 'text', values: ['stone', 'cherry'] },
        topN: 2
      })
      expect(result.ranking).toEqual([
        { originalIndex: 1, score: 0.9, document: 'cherry' },
        { originalIndex: 0, score: 0.2, document: 'stone' }
      ])
      expect(result.rerankedDocuments).toEqual(['cherry', 'stone'])
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ modality: 'rerank', modelId: 'reranker' })
    }
  )
})
