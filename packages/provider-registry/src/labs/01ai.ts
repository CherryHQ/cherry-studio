import { openaiCompatible } from './_api'
import { defineLab } from './types'

export default defineLab({
  id: '01ai',
  name: '01.AI (Yi)',
  fetchModels: openaiCompatible('yi', 'YI_API_KEY'),
  families: ['yi'],
  idPrefixes: ['yi']
})
