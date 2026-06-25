import { defineLab } from './types'

export default defineLab({
  id: 'sentence-transformers',
  name: 'Sentence Transformers',
  kind: 'embedding',
  idPrefixes: ['all-minilm', 'all-mpnet', 'e5-', 'multilingual-e5', 'gte-', 'm3e']
})
