import { openaiCompatible } from './_api'
import { defineCreator } from './types'

export default defineCreator({
  id: 'stepfun',
  name: 'StepFun',
  fetchModels: openaiCompatible('stepfun', 'STEPFUN_API_KEY'),
  modelsDevProviders: ['stepfun', 'stepfun-ai'],
  idPrefixes: ['step'],
  reasoningFamilies: [
    { pattern: '^step-5-preview$', effort: ['low', 'medium', 'high'] },
    { pattern: 'step-3' },
    { pattern: 'step-r1-v-mini' }
  ],
  models: [
    // TokenHub-served flagship preview (1M context, text/image/video in, always-on
    // reasoning). Hand-listed to pin the TokenHub-relevant identity; upstream
    // listings enrich the remaining metadata at generation time.
    {
      id: 'step-5-preview',
      name: 'Step 5 Preview',
      capabilities: ['reasoning', 'function-call', 'image-recognition', 'video-recognition'],
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['text'],
      contextWindow: 1048576
    }
  ]
})
