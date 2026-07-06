import { openaiCompatible } from './_api'
import { defineCreator } from './types'

export default defineCreator({
  id: 'baichuan',
  name: 'Baichuan',
  fetchModels: openaiCompatible('baichuan', 'BAICHUAN_API_KEY'),
  families: ['baichuan'],
  idPrefixes: ['baichuan']
})
