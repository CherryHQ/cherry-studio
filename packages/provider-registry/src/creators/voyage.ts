import { defineCreator } from './types'

// Voyage AI — embedders + rerankers (docs.voyageai.com). `kind: 'embedding'` auto-tags every model
// `embedding` (+ `vector` output); the generator re-tags `rerank-*` ids as `rerank`. Context lengths
// from the model tables. Rerankers are hand-listed (no generic `rerank-` idPrefix, which would over-claim).
export default defineCreator({
  id: 'voyage',
  name: 'Voyage AI',
  kind: 'embedding',
  families: ['voyage'],
  idPrefixes: ['voyage'],
  models: [
    // ── Text embeddings ──
    { id: 'voyage-4-large', name: 'Voyage 4 Large', contextWindow: 32000 },
    { id: 'voyage-4', name: 'Voyage 4', contextWindow: 32000 },
    { id: 'voyage-4-lite', name: 'Voyage 4 Lite', contextWindow: 32000 },
    { id: 'voyage-4-nano', name: 'Voyage 4 Nano', contextWindow: 32000 },
    { id: 'voyage-3-large', name: 'Voyage 3 Large', contextWindow: 32000 },
    { id: 'voyage-3-5', name: 'Voyage 3.5', contextWindow: 32000 },
    { id: 'voyage-3-5-lite', name: 'Voyage 3.5 Lite', contextWindow: 32000 },
    { id: 'voyage-3', name: 'Voyage 3', contextWindow: 32000 },
    { id: 'voyage-3-lite', name: 'Voyage 3 Lite', contextWindow: 32000 },
    { id: 'voyage-code-3', name: 'Voyage Code 3', contextWindow: 32000 },
    { id: 'voyage-code-2', name: 'Voyage Code 2', contextWindow: 16000 },
    { id: 'voyage-finance-2', name: 'Voyage Finance 2', contextWindow: 32000 },
    { id: 'voyage-law-2', name: 'Voyage Law 2', contextWindow: 16000 },
    { id: 'voyage-multilingual-2', name: 'Voyage Multilingual 2', contextWindow: 32000 },
    { id: 'voyage-large-2-instruct', name: 'Voyage Large 2 Instruct', contextWindow: 16000 },
    { id: 'voyage-large-2', name: 'Voyage Large 2', contextWindow: 16000 },
    { id: 'voyage-2', name: 'Voyage 2', contextWindow: 4000 },
    // ── Multimodal embeddings (interleaved text + visual) ──
    {
      id: 'voyage-multimodal-3-5',
      name: 'Voyage Multimodal 3.5',
      contextWindow: 32000,
      inputModalities: ['text', 'image', 'video']
    },
    {
      id: 'voyage-multimodal-3',
      name: 'Voyage Multimodal 3',
      contextWindow: 32000,
      inputModalities: ['text', 'image']
    },
    // ── Rerankers ──
    { id: 'rerank-2-5', name: 'Rerank 2.5', capabilities: ['rerank'], contextWindow: 32000 },
    { id: 'rerank-2-5-lite', name: 'Rerank 2.5 Lite', capabilities: ['rerank'], contextWindow: 32000 },
    { id: 'rerank-2', name: 'Rerank 2', capabilities: ['rerank'], contextWindow: 16000 },
    { id: 'rerank-2-lite', name: 'Rerank 2 Lite', capabilities: ['rerank'], contextWindow: 8000 },
    { id: 'rerank-1', name: 'Rerank 1', capabilities: ['rerank'], contextWindow: 8000 },
    { id: 'rerank-lite-1', name: 'Rerank Lite 1', capabilities: ['rerank'], contextWindow: 4000 }
  ]
})
