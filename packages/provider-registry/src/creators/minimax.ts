import { defineCreator } from './types'

export default defineCreator({
  id: 'minimax',
  name: 'MiniMax',
  modelsDevProviders: ['minimax', 'minimax-cn'],
  idPrefixes: ['minimax', 'abab'],
  reasoningMembership: ['minimax-m[123]']
})
