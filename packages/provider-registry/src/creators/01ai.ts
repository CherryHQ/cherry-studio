import { openaiCompatible } from './_api'
import { defineCreator } from './types'

export default defineCreator({
  id: '01ai',
  name: '01.AI (Yi)',
  fetchModels: openaiCompatible('yi', 'YI_API_KEY'),
  families: ['yi'],
  idPrefixes: ['yi']
})
