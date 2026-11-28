import { defineCreator } from './types'

export default defineCreator({
  id: 'sakana',
  name: 'Sakana AI',
  idPrefixes: ['fugu', 'namazu'],
  reasoningFamilies: [
    { pattern: '^fugu-(?:max|ultra(?:-v2)?)$', effort: ['high', 'xhigh', 'max'] },
    { pattern: '^namazu$', effort: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] }
  ]
})
