import { openaiCompatible } from './_api'
import { defineCreator } from './types'

export default defineCreator({
  id: 'deepseek',
  name: 'DeepSeek',
  fetchModels: openaiCompatible('deepseek', 'DEEPSEEK_API_KEY'),
  modelsDevProviders: ['deepseek'],
  idPrefixes: ['deepseek'],
  reasoningMembership: [
    '(\\w+-)?deepseek-v3(?:\\.\\d|-\\d)(?:(\\.|-)(?!speciale$)\\w+)?$',
    'deepseek-chat',
    'deepseek-v(?:[4-9]\\d*|[1-9]\\d{1,})(?:\\.\\d+)?(?:-[\\w]+)*(?=$|[:/])',
    'deepseek-v3\\.2-speciale'
  ],
  reasoningFamilies: [
    { pattern: '^deepseek-v(?:[4-9]\\d*|[1-9]\\d{1,})(?:\\.\\d+)?', effort: ['none', 'high', 'max'] },
    // v3.x hybrid inference (thinking / non-thinking at one endpoint).
    { pattern: 'deepseek-(?:chat|v3(?:\\.\\d|-\\d))', toggle: true }
  ]
})
