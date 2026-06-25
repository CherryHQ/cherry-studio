import { openaiCompatible } from './_api'
import { defineLab } from './types'

export default defineLab({
  id: 'deepseek',
  name: 'DeepSeek',
  fetchModels: openaiCompatible('deepseek', 'DEEPSEEK_API_KEY'),
  modelsDevProviders: ['deepseek'],
  idPrefixes: ['deepseek']
})
