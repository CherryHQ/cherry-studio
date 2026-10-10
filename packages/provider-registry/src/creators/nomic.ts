import { defineCreator } from './types'

export default defineCreator({
  id: 'nomic',
  name: 'Nomic',
  kind: 'embedding',
  idPrefixes: ['nomic-embed']
})
