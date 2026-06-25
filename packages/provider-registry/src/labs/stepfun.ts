import { openaiCompatible } from './_api'
import { defineLab } from './types'

export default defineLab({
  id: 'stepfun',
  name: 'StepFun',
  fetchModels: openaiCompatible('stepfun', 'STEPFUN_API_KEY'),
  modelsDevProviders: ['stepfun', 'stepfun-ai'],
  idPrefixes: ['step']
})
