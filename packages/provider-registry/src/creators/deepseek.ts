import { openaiCompatible } from './_api'
import { defineCreator } from './types'

export default defineCreator({
  id: 'deepseek',
  name: 'DeepSeek',
  fetchModels: openaiCompatible('deepseek', 'DEEPSEEK_API_KEY'),
  modelsDevProviders: ['deepseek'],
  idPrefixes: ['deepseek'],
  serverTools: {
    'web-search': [
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'deepseek-v3-2',
      'deepseek-v3-1',
      'deepseek-r1',
      'deepseek-v3'
    ]
  },
  reasoningFamilies: [
    { pattern: '^deepseek-v(?:[4-9]\\d*|[1-9]\\d{1,})(?:\\.\\d+)?', effort: ['none', 'high', 'max'] },
    // v3.x hybrid inference (thinking / non-thinking at one endpoint).
    { pattern: 'deepseek-(?:chat|v3(?:\\.\\d|-\\d))', toggle: true, template: true },
    // Membership profiles (no knobs): reasoning SKUs beyond the knob rules above.
    { pattern: '(\\w+-)?deepseek-v3(?:\\.\\d|-\\d)(?:(\\.|-)(?!speciale$)\\w+)?$' },
    { pattern: 'deepseek-chat' },
    { pattern: 'deepseek-v(?:[4-9]\\d*|[1-9]\\d{1,})(?:\\.\\d+)?(?:-[\\w]+)*(?=$|[:/])' },
    { pattern: 'deepseek-v3\\.2-speciale' }
  ]
})
