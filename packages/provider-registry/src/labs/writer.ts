import { openaiCompatible } from './_api'
import { defineLab } from './types'

export default defineLab({
  id: 'writer',
  name: 'Writer',
  fetchModels: openaiCompatible('https://api.writer.com/v1', 'WRITER_API_KEY'),
  families: ['palmyra'],
  idPrefixes: ['palmyra']
})
