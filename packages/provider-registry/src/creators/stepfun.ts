import { openaiCompatible } from './_api'
import { defineCreator } from './types'

export default defineCreator({
  id: 'stepfun',
  name: 'StepFun',
  fetchModels: openaiCompatible('stepfun', 'STEPFUN_API_KEY'),
  modelsDevProviders: ['stepfun', 'stepfun-ai'],
  idPrefixes: ['step'],
  reasoningMembership: ['step-3', 'step-r1-v-mini']
})
