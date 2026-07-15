import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'stepfun',
  name: 'StepFun',
  baseUrl: 'https://api.stepfun.com',
  anthropic: 'https://api.stepfun.com',
  website: {
    apiKey: 'https://platform.stepfun.com/interface-key',
    docs: 'https://platform.stepfun.com/docs/overview/concept',
    models: 'https://platform.stepfun.com/docs/llm/text',
    official: 'https://platform.stepfun.com/'
  }
})
