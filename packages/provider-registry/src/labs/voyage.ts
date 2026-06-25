import { defineLab } from './types'

export default defineLab({
  id: 'voyage',
  name: 'Voyage AI',
  kind: 'embedding',
  families: ['voyage'],
  idPrefixes: ['voyage', 'rerank-']
})
