import type { Model } from '@renderer/types'

export const dmxapiModels: Model[] = [
  {
    id: 'Qwen/Qwen2.5-7B-Instruct',
    provider: 'dmxapi',
    name: 'Qwen/Qwen2.5-7B-Instruct',
    group: '免费模型'
  },
  {
    id: 'ERNIE-Speed-128K',
    provider: 'dmxapi',
    name: 'ERNIE-Speed-128K',
    group: '免费模型'
  },
  {
    id: 'gpt-4o',
    provider: 'dmxapi',
    name: 'gpt-4o',
    group: 'OpenAI'
  },
  {
    id: 'gpt-4o-mini',
    provider: 'dmxapi',
    name: 'gpt-4o-mini',
    group: 'OpenAI'
  },
  {
    id: 'DMXAPI-DeepSeek-R1',
    provider: 'dmxapi',
    name: 'DMXAPI-DeepSeek-R1',
    group: 'DeepSeek'
  },
  {
    id: 'DMXAPI-DeepSeek-V3',
    provider: 'dmxapi',
    name: 'DMXAPI-DeepSeek-V3',
    group: 'DeepSeek'
  },
  {
    id: 'claude-3-5-sonnet-20241022',
    provider: 'dmxapi',
    name: 'claude-3-5-sonnet-20241022',
    group: 'Claude'
  },
  {
    id: 'gemini-2.0-flash',
    provider: 'dmxapi',
    name: 'gemini-2.0-flash',
    group: 'Gemini'
  }
]
