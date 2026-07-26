import { openaiCompatible } from './_api'
import { defineCreator } from './types'

export default defineCreator({
  id: 'meituan',
  name: 'Meituan (LongCat)',
  fetchModels: openaiCompatible('longcat', 'LONGCAT_API_KEY'),
  families: ['longcat'],
  idPrefixes: ['longcat'],
  reasoningFamilies: [{ pattern: '^longcat-2[.-]0$', toggle: true }],
  models: [
    {
      id: 'longcat-2-0',
      name: 'LongCat-2.0',
      description:
        'LongCat-2.0 is a high-performance agentic model with native tool calling, multi-step reasoning, a 1M-token context window, and a 128K-token maximum output.',
      family: 'longcat',
      capabilities: ['function-call', 'reasoning'],
      inputModalities: ['text'],
      outputModalities: ['text'],
      contextWindow: 1048576,
      maxOutputTokens: 131072
    }
  ]
})
