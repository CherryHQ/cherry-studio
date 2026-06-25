import { openaiCompatible } from './_api'
import { defineLab } from './types'

export default defineLab({
  id: 'meituan',
  name: 'Meituan (LongCat)',
  fetchModels: openaiCompatible('longcat', 'LONGCAT_API_KEY'),
  families: ['longcat'],
  idPrefixes: ['longcat']
})
