import { defineCreator } from './types'

export default defineCreator({
  id: 'sentence-transformers',
  name: 'Sentence Transformers',
  kind: 'embedding',
  idPrefixes: ['all-minilm', 'all-mpnet', 'e5-', 'multilingual-e5', 'gte-', 'm3e']
})
