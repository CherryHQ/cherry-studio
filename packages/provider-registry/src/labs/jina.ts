import { defineLab } from './types'

// Jina's embedders/rerankers exist in no upstream source (models.dev has no jina key; OpenRouter carries
// no embeddings), so the line is hand-listed here, verified against https://jina.ai/models/.
// Metadata (name + max input context + image modality) is from that page; `kind: 'embedding'` adds the
// `embedding` capability + `vector` output, ids with `reranker` add `rerank` instead. (dimensions/params
// aren't ModelConfig fields; jina doesn't publish per-model pricing. reader-lm/jina-vlm text models omitted.)
const IMG = ['text', 'image'] as const

export default defineLab({
  id: 'jina',
  name: 'Jina AI',
  kind: 'embedding',
  idPrefixes: ['jina'],
  models: [
    { id: 'jina-embeddings-v5-text-small', name: 'Jina Embeddings v5 Text Small', contextWindow: 32768 },
    { id: 'jina-embeddings-v5-text-nano', name: 'Jina Embeddings v5 Text Nano', contextWindow: 8192 },
    {
      id: 'jina-embeddings-v5-omni-small',
      name: 'Jina Embeddings v5 Omni Small',
      contextWindow: 32768,
      inputModalities: [...IMG]
    },
    {
      id: 'jina-embeddings-v5-omni-nano',
      name: 'Jina Embeddings v5 Omni Nano',
      contextWindow: 8192,
      inputModalities: [...IMG]
    },
    { id: 'jina-embeddings-v4', name: 'Jina Embeddings v4', contextWindow: 32768, inputModalities: [...IMG] },
    { id: 'jina-embeddings-v3', name: 'Jina Embeddings v3', contextWindow: 8192 },
    { id: 'jina-embeddings-v2-base-en', name: 'Jina Embeddings v2 Base EN', contextWindow: 8192 },
    { id: 'jina-embeddings-v2-base-zh', name: 'Jina Embeddings v2 Base ZH', contextWindow: 8192 },
    { id: 'jina-embeddings-v2-base-de', name: 'Jina Embeddings v2 Base DE', contextWindow: 8192 },
    { id: 'jina-embeddings-v2-base-es', name: 'Jina Embeddings v2 Base ES', contextWindow: 8192 },
    { id: 'jina-embeddings-v2-base-code', name: 'Jina Embeddings v2 Base Code', contextWindow: 8192 },
    { id: 'jina-embedding-b-en-v1', name: 'Jina Embedding B EN v1', contextWindow: 512 },
    { id: 'jina-clip-v2', name: 'Jina CLIP v2', contextWindow: 8192, inputModalities: [...IMG] },
    { id: 'jina-clip-v1', name: 'Jina CLIP v1', contextWindow: 8192, inputModalities: [...IMG] },
    { id: 'jina-code-embeddings-1-5b', name: 'Jina Code Embeddings 1.5B', contextWindow: 32768 },
    { id: 'jina-code-embeddings-0-5b', name: 'Jina Code Embeddings 0.5B', contextWindow: 32768 },
    { id: 'jina-colbert-v2', name: 'Jina ColBERT v2', contextWindow: 8192 },
    { id: 'jina-colbert-v1-en', name: 'Jina ColBERT v1 EN', contextWindow: 8192 },
    { id: 'jina-reranker-v3', name: 'Jina Reranker v3', contextWindow: 131072 },
    { id: 'jina-reranker-m0', name: 'Jina Reranker m0', contextWindow: 10240, inputModalities: [...IMG] },
    { id: 'jina-reranker-v2-base-multilingual', name: 'Jina Reranker v2 Base Multilingual', contextWindow: 1024 },
    { id: 'jina-reranker-v1-base-en', name: 'Jina Reranker v1 Base EN', contextWindow: 8192 },
    { id: 'jina-reranker-v1-turbo-en', name: 'Jina Reranker v1 Turbo EN', contextWindow: 8192 },
    { id: 'jina-reranker-v1-tiny-en', name: 'Jina Reranker v1 Tiny EN', contextWindow: 8192 }
  ]
})
