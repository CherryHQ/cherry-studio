import { defineCreator } from './types'

export default defineCreator({
  id: 'scaledown',
  name: 'ScaleDown',
  idPrefixes: ['scaledown-extract', 'scaledown-summarize'],
  models: [{ id: 'scaledown-extract-1', capabilities: ['structured-output'] }]
})
