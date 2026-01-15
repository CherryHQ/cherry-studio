/**
 * Embedding Pipeline for KnowledgeServiceV2
 *
 * Handles batch embedding of nodes using the configured embedding model.
 */

import { loggerService } from '@logger'
import type { BaseNode, Metadata } from '@vectorstores/core'
import { MetadataMode } from '@vectorstores/core'

import Embeddings from '../embeddings'
import type { ResolvedKnowledgeBase } from '../KnowledgeProviderAdapter'

const logger = loggerService.withContext('EmbeddingPipeline')

/**
 * Batch embed nodes using the configured embedding model
 *
 * @param nodes Nodes to embed (without embeddings)
 * @param base Knowledge base params containing embedding config
 * @param onProgress Optional callback for progress updates (0-100)
 * @returns Nodes with embeddings attached
 */
export async function embedNodes(
  nodes: BaseNode<Metadata>[],
  base: ResolvedKnowledgeBase,
  onProgress?: (progress: number) => void
): Promise<BaseNode<Metadata>[]> {
  if (nodes.length === 0) {
    return []
  }

  logger.debug(`Embedding ${nodes.length} nodes for base ${base.id}`)

  const embeddings = new Embeddings({
    embedApiClient: base.embedApiClient,
    dimensions: base.dimensions
  })

  // Extract text from nodes
  const texts = nodes.map((node) => node.getContent(MetadataMode.NONE))

  // Batch embed all texts with progress callback
  const vectors = await embeddings.embedDocuments(texts, onProgress)

  logger.debug(`Embedded ${vectors.length} vectors (dimensions: ${vectors[0]?.length ?? 0})`)

  // Attach embeddings to nodes
  vectors.forEach((vector, index) => {
    const node = nodes[index]
    if (node) {
      node.embedding = vector
    }
  })

  return nodes
}

/**
 * Embed a single query string
 *
 * @param query Query string to embed
 * @param base Knowledge base params containing embedding config
 * @returns Embedding vector
 */
export async function embedQuery(query: string, base: ResolvedKnowledgeBase): Promise<number[]> {
  const embeddings = new Embeddings({
    embedApiClient: base.embedApiClient,
    dimensions: base.dimensions
  })

  return embeddings.embedQuery(query)
}

/**
 * EmbeddingPipeline class for more complex scenarios
 */
export class EmbeddingPipeline {
  private embeddings: Embeddings

  constructor(base: ResolvedKnowledgeBase) {
    this.embeddings = new Embeddings({
      embedApiClient: base.embedApiClient,
      dimensions: base.dimensions
    })
  }

  /**
   * Embed nodes in batches to avoid memory issues with large datasets
   *
   * @param nodes Nodes to embed
   * @param batchSize Number of nodes per batch (default: 100)
   * @returns Nodes with embeddings
   */
  async embedInBatches(nodes: BaseNode<Metadata>[], batchSize = 100): Promise<BaseNode<Metadata>[]> {
    if (nodes.length === 0) {
      return []
    }

    const results: BaseNode<Metadata>[] = []

    for (let i = 0; i < nodes.length; i += batchSize) {
      const batch = nodes.slice(i, i + batchSize)
      const texts = batch.map((node) => node.getContent(MetadataMode.NONE))

      logger.debug(`Embedding batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(nodes.length / batchSize)}`)

      const vectors = await this.embeddings.embedDocuments(texts)

      vectors.forEach((vector, index) => {
        const node = batch[index]
        if (node) {
          node.embedding = vector
          results.push(node)
        }
      })
    }

    return results
  }

  /**
   * Embed a single query
   */
  async embedQuery(query: string): Promise<number[]> {
    return this.embeddings.embedQuery(query)
  }
}
