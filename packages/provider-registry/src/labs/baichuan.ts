import { openaiCompatible } from './_api'
import { defineLab } from './types'

export default defineLab({
  id: 'baichuan',
  name: 'Baichuan',
  fetchModels: openaiCompatible('baichuan', 'BAICHUAN_API_KEY'),
  families: ['baichuan'],
  idPrefixes: ['baichuan']
})
