import { openaiCompatible } from './types'

/** WaveSpeed's LLM gateway lists its `vendor/model` chat ids at `/v1/models`. */
export default openaiCompatible({
  id: 'wavespeed',
  name: 'WaveSpeed',
  availableInEditions: ['global'],
  baseUrl: 'https://llm.wavespeed.ai/v1',
  website: {
    apiKey: 'https://wavespeed.ai/accesskey',
    docs: 'https://wavespeed.ai/docs',
    models: 'https://wavespeed.ai/models',
    official: 'https://wavespeed.ai'
  }
})
