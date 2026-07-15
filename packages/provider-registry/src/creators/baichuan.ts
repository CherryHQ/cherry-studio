import { openaiCompatible } from './_api'
import { defineCreator } from './types'

export default defineCreator({
  id: 'baichuan',
  name: 'Baichuan',
  fetchModels: openaiCompatible('baichuan', 'BAICHUAN_API_KEY'),
  families: ['baichuan'],
  idPrefixes: ['baichuan'],
  reasoningMembership: ['^baichuan-m[23]$'],
  reasoningFamilies: [
    { pattern: 'baichuan-m2$', budget: { min: 0, max: 30000 } },
    { pattern: 'baichuan-m3$', budget: { min: 0, max: 30000 } }
  ]
})
