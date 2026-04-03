import type { EmbeddingModelV3 } from '@ai-sdk/provider'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { createOllama, type OllamaProvider } from 'ollama-ai-provider-v2'

import { type CompositeModelRef, parseCompositeModelId } from '../utils/config'

/**
 * Knowledge embedding model factory.
 *
 * Minimal knowledge-domain embedding factory.
 * Only ollama is supported in this first pass.
 */
export class EmbeddingModelFactory {
  private readonly ollamaProvider: Pick<OllamaProvider, 'textEmbeddingModel'>

  constructor(ollamaProvider: Pick<OllamaProvider, 'textEmbeddingModel'> = createOllama()) {
    this.ollamaProvider = ollamaProvider
  }

  static fromProvider(
    providerId: string,
    ollamaProvider: Pick<OllamaProvider, 'textEmbeddingModel'>
  ): EmbeddingModelFactory {
    if (providerId !== 'ollama') {
      throw new Error(`Unsupported embedding provider: ${providerId}`)
    }

    return new EmbeddingModelFactory(ollamaProvider)
  }

  static create(input: CompositeModelRef | Pick<KnowledgeBase, 'embeddingModelId'>): EmbeddingModelV3 {
    if ('embeddingModelId' in input) {
      return EmbeddingModelFactory.createFromCompositeModelId(input.embeddingModelId)
    }

    return new EmbeddingModelFactory().fromRef(input)
  }

  static createFromCompositeModelId(compositeModelId: string): EmbeddingModelV3 {
    return EmbeddingModelFactory.create(parseCompositeModelId(compositeModelId))
  }

  create(ref: CompositeModelRef): EmbeddingModelV3 {
    return this.fromRef(ref)
  }

  createFromCompositeModelId(compositeModelId: string): EmbeddingModelV3 {
    return this.fromRef(parseCompositeModelId(compositeModelId))
  }

  fromRef(ref: CompositeModelRef): EmbeddingModelV3 {
    if (!ref.providerId || !ref.modelId) {
      throw new Error('Invalid embedding model reference. Both providerId and modelId are required.')
    }

    if (ref.providerId !== 'ollama') {
      throw new Error(`Unsupported embedding provider: ${ref.providerId}`)
    }

    return this.ollamaProvider.textEmbeddingModel(ref.modelId)
  }
}
