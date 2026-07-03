import { openaiCompatible } from './_api'
import { defineCreator } from './types'

export default defineCreator({
  id: 'meituan',
  name: 'Meituan (LongCat)',
  fetchModels: openaiCompatible('longcat', 'LONGCAT_API_KEY'),
  families: ['longcat'],
  idPrefixes: ['longcat']
})
