import { defineCreator } from './types'

export default defineCreator({
  id: 'reflection',
  name: 'Reflection AI',
  idPrefixes: ['beam'],
  reasoningFamilies: [{ pattern: '^beam$', effort: ['low', 'medium', 'high', 'xhigh', 'max'] }]
})
