import { openaiCompatible } from './_api'
import { defineLab } from './types'

export default defineLab({
  id: 'upstage',
  name: 'Upstage',
  fetchModels: openaiCompatible('https://api.upstage.ai/v1', 'UPSTAGE_API_KEY'),
  modelsDevProviders: ['upstage'],
  idPrefixes: ['solar']
})
