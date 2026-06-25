import { openaiCompatible } from './_api'
import { defineLab } from './types'

export default defineLab({
  id: 'baidu',
  name: 'Baidu (ERNIE)',
  fetchModels: openaiCompatible('baidu-cloud', 'QIANFAN_API_KEY'),
  families: ['ernie'],
  idPrefixes: ['ernie']
})
