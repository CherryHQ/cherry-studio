export const EMBEDDING_MODELS = [
  {
    id: 'Doubao-embedding',
    max_context: 4095
  },
  {
    id: 'Doubao-embedding-vision',
    max_context: 8191
  },
  {
    id: 'Doubao-embedding-large',
    max_context: 4095
  },
  {
    id: 'text-embedding-v3',
    max_context: 8192
  },
  {
    id: 'text-embedding-v2',
    max_context: 2048
  },
  {
    id: 'text-embedding-v1',
    max_context: 2048
  },
  {
    id: 'text-embedding-async-v2',
    max_context: 2048
  },
  {
    id: 'text-embedding-async-v1',
    max_context: 2048
  },
  {
    id: 'text-embedding-3-small',
    max_context: 8191
  },
  {
    id: 'text-embedding-3-large',
    max_context: 8191
  },
  {
    id: 'text-embedding-ada-002',
    max_context: 8191
  },
  {
    id: 'Embedding-V1',
    max_context: 384
  },
  {
    id: 'tao-8k',
    max_context: 8192
  },
  {
    id: 'embedding-2',
    max_context: 1024
  },
  {
    id: 'embedding-3',
    max_context: 2048
  },
  {
    id: 'hunyuan-embedding',
    max_context: 1024
  },
  {
    id: 'Baichuan-Text-Embedding',
    max_context: 512
  },
  {
    id: 'M2-BERT-80M-2K-Retrieval',
    max_context: 2048
  },
  {
    id: 'M2-BERT-80M-8K-Retrieval',
    max_context: 8192
  },
  {
    id: 'M2-BERT-80M-32K-Retrieval',
    max_context: 32768
  },
  {
    id: 'UAE-Large-v1',
    max_context: 512
  },
  {
    id: 'BGE-Large-EN-v1.5',
    max_context: 512
  },
  {
    id: 'BGE-Base-EN-v1.5',
    max_context: 512
  },
  {
    id: 'jina-embedding-b-en-v1',
    max_context: 512
  },
  {
    id: 'jina-embeddings-v2-base-en',
    max_context: 8191
  },
  {
    id: 'jina-embeddings-v2-base-zh',
    max_context: 8191
  },
  {
    id: 'jina-embeddings-v2-base-de',
    max_context: 8191
  },
  {
    id: 'jina-embeddings-v2-base-code',
    max_context: 8191
  },
  {
    id: 'jina-embeddings-v2-base-es',
    max_context: 8191
  },
  {
    id: 'jina-colbert-v1-en',
    max_context: 8191
  },
  {
    id: 'jina-reranker-v1-base-en',
    max_context: 8191
  },
  {
    id: 'jina-reranker-v1-turbo-en',
    max_context: 8191
  },
  {
    id: 'jina-reranker-v1-tiny-en',
    max_context: 8191
  },
  {
    id: 'jina-clip-v1',
    max_context: 8191
  },
  {
    id: 'jina-reranker-v2-base-multilingual',
    max_context: 8191
  },
  {
    id: 'reader-lm-1.5b',
    max_context: 256000
  },
  {
    id: 'reader-lm-0.5b',
    max_context: 256000
  },
  {
    id: 'jina-colbert-v2',
    max_context: 8191
  },
  {
    id: 'jina-embeddings-v3',
    max_context: 8191
  },
  {
    id: 'BAAI/bge-m3',
    max_context: 8191
  },
  {
    id: 'netease-youdao/bce-embedding-base_v1',
    max_context: 512
  },
  {
    id: 'BAAI/bge-large-zh-v1.5',
    max_context: 512
  },
  {
    id: 'BAAI/bge-large-en-v1.5',
    max_context: 512
  },
  {
    id: 'Pro/BAAI/bge-m3',
    max_context: 8191
  },
  {
    id: 'nomic-embed-text-v1',
    max_context: 8192
  },
  {
    id: 'nomic-embed-text-v1.5',
    max_context: 8192
  },
  {
    id: 'gte-multilingual-base',
    max_context: 8192
  },
  {
    id: 'embedding-query',
    max_context: 4000
  },
  {
    id: 'embedding-passage',
    max_context: 4000
  },
  {
    id: 'embed-english-v3.0',
    max_context: 512
  },
  {
    id: 'embed-english-light-v3.0',
    max_context: 512
  },
  {
    id: 'embed-multilingual-v3.0',
    max_context: 512
  },
  {
    id: 'embed-multilingual-light-v3.0',
    max_context: 512
  },
  {
    id: 'embed-english-v2.0',
    max_context: 512
  },
  {
    id: 'embed-english-light-v2.0',
    max_context: 512
  },
  {
    id: 'embed-multilingual-v2.0',
    max_context: 256
  },
  {
    id: 'text-embedding-004',
    max_context: 2048
  },
  {
    id: 'deepset-mxbai-embed-de-large-v1',
    max_context: 512
  },
  {
    id: 'mxbai-embed-large-v1',
    max_context: 512
  },
  {
    id: 'mxbai-embed-2d-large-v1',
    max_context: 512
  },
  {
    id: 'mistral-embed',
    max_context: 8000
  }
]

export function getEmbeddingMaxContext(id: string) {
  const model = EMBEDDING_MODELS.find((m) => m.id === id)

  if (model) {
    return model.max_context
  }

  if (id.includes('bge-large')) {
    return 512
  }

  if (id.includes('bge-m3')) {
    return 8000
  }

  return undefined
}
