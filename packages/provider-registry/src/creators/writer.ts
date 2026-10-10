import { openaiCompatible } from './_api'
import { defineCreator } from './types'

export default defineCreator({
  id: 'writer',
  name: 'Writer',
  fetchModels: openaiCompatible('https://api.writer.com/v1', 'WRITER_API_KEY'),
  families: ['palmyra'],
  idPrefixes: ['palmyra']
})
