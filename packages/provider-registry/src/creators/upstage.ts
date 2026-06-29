import { openaiCompatible } from './_api'
import { defineCreator } from './types'

export default defineCreator({
  id: 'upstage',
  name: 'Upstage',
  fetchModels: openaiCompatible('https://api.upstage.ai/v1', 'UPSTAGE_API_KEY'),
  modelsDevProviders: ['upstage'],
  idPrefixes: ['solar']
})
