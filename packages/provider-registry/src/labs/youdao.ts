import { defineLab } from './types'

// NetEase Youdao's BCE embedding/reranker line (BCEmbedding) — served under the `bce-` prefix, in no
// clean upstream listing, so hand-listed here. A SEPARATE creator from BAAI (`baai.ts`) even though both
// ship `bce-`/`bge-` retrieval models. `kind: 'embedding'` derives the `embedding` capability + `vector`
// output; the reranker is tagged `rerank`. Context windows from the HF model cards (BCEmbedding, 512).
export default defineLab({
  id: 'youdao',
  name: 'NetEase Youdao (BCE)',
  kind: 'embedding',
  idPrefixes: ['bce'],
  models: [
    { id: 'bce-embedding-base-v1', name: 'BCE Embedding Base v1', contextWindow: 512 },
    { id: 'bce-reranker-base-v1', name: 'BCE Reranker Base v1', capabilities: ['rerank'], contextWindow: 512 }
  ]
})
