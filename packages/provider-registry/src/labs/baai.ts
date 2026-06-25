import { defineLab } from './types'

// BAAI's BGE family (+ Youdao BCE, served under the same `bce-` prefix) isn't in a clean upstream listing,
// so it's hand-listed. `kind: 'embedding'` derives the `embedding` capability + `vector` output for the
// plain models; any id containing `reranker` is tagged `rerank` instead. Each model carries its display
// `name` + context window (HF model cards: v1.5 family 512; m3 / gemma-based 8192).
export default defineLab({
  id: 'baai',
  name: 'BAAI (BGE)',
  kind: 'embedding',
  families: ['bge'],
  idPrefixes: ['bge', 'bce'],
  models: [
    { id: 'bge-m3', name: 'BGE M3', contextWindow: 8192 },
    { id: 'bge-multilingual-gemma2', name: 'BGE Multilingual Gemma2', contextWindow: 8192 },
    { id: 'bge-large-en-v1-5', name: 'BGE Large EN v1.5', contextWindow: 512 },
    { id: 'bge-large-zh-v1-5', name: 'BGE Large ZH v1.5', contextWindow: 512 },
    { id: 'bge-base-en-v1-5', name: 'BGE Base EN v1.5', contextWindow: 512 },
    { id: 'bge-base-zh-v1-5', name: 'BGE Base ZH v1.5', contextWindow: 512 },
    { id: 'bge-small-en-v1-5', name: 'BGE Small EN v1.5', contextWindow: 512 },
    { id: 'bge-small-zh-v1-5', name: 'BGE Small ZH v1.5', contextWindow: 512 },
    { id: 'bce-embedding-base-v1', name: 'BCE Embedding Base v1', contextWindow: 512 },
    // Rerankers are the exception to the lab's `kind: 'embedding'` — mark them explicitly so they're not
    // tagged as embedders by default (the generator also infers `rerank` from the id, this makes it certain).
    { id: 'bge-reranker-v2-m3', name: 'BGE Reranker v2 M3', capabilities: ['rerank'], contextWindow: 8192 },
    { id: 'bge-reranker-v2-gemma', name: 'BGE Reranker v2 Gemma', capabilities: ['rerank'], contextWindow: 8192 },
    { id: 'bge-reranker-large', name: 'BGE Reranker Large', capabilities: ['rerank'], contextWindow: 512 },
    { id: 'bge-reranker-base', name: 'BGE Reranker Base', capabilities: ['rerank'], contextWindow: 512 },
    { id: 'bce-reranker-base-v1', name: 'BCE Reranker Base v1', capabilities: ['rerank'], contextWindow: 512 }
  ]
})
