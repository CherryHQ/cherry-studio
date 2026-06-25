import { openaiCompatible } from './_api'
import { defineLab } from './types'

export default defineLab({
  id: 'baidu',
  name: 'Baidu (ERNIE)',
  fetchModels: openaiCompatible('baidu-cloud', 'QIANFAN_API_KEY'),
  families: ['ernie'],
  idPrefixes: ['ernie', 'irag'],
  models: [
    { id: 'ernie-5-0', name: 'ERNIE 5.0', capabilities: ['reasoning', 'function-call'], contextWindow: 131072 },
    {
      id: 'ernie-x1-turbo',
      name: 'ERNIE X1 Turbo',
      capabilities: ['reasoning', 'function-call'],
      contextWindow: 32768
    },
    {
      id: 'ernie-x1-1-preview',
      name: 'ERNIE X1.1 Preview',
      capabilities: ['reasoning', 'function-call'],
      contextWindow: 32768
    },
    { id: 'ernie-4-5', name: 'ERNIE 4.5', capabilities: ['function-call'], contextWindow: 123904 },
    { id: 'ernie-4-5-turbo', name: 'ERNIE 4.5 Turbo', capabilities: ['function-call'], contextWindow: 131072 },
    {
      id: 'ernie-4-5-turbo-vl',
      name: 'ERNIE 4.5 Turbo VL',
      capabilities: ['function-call', 'image-recognition'],
      inputModalities: ['text', 'image'],
      contextWindow: 32768
    },
    {
      id: 'ernie-4-5-vl-a3b',
      name: 'ERNIE 4.5 VL A3B',
      capabilities: ['reasoning', 'image-recognition'],
      inputModalities: ['text', 'image'],
      contextWindow: 32768
    },
    { id: 'ernie-4-5-a3b', name: 'ERNIE 4.5 A3B', capabilities: ['function-call'], contextWindow: 131072 },
    { id: 'ernie-4-5-a47b', name: 'ERNIE 4.5 A47B', capabilities: ['function-call'], contextWindow: 131072 },
    { id: 'ernie-4-0-8k', name: 'ERNIE 4.0 8K', capabilities: ['function-call'], contextWindow: 8192 },
    { id: 'ernie-4-0-turbo-8k', name: 'ERNIE 4.0 Turbo 8K', capabilities: ['function-call'], contextWindow: 8192 },
    {
      id: 'ernie-4-0-turbo-128k',
      name: 'ERNIE 4.0 Turbo 128K',
      capabilities: ['function-call'],
      contextWindow: 131072
    },
    { id: 'ernie-3-5-8k', name: 'ERNIE 3.5 8K', capabilities: ['function-call'], contextWindow: 8192 },
    { id: 'ernie-3-5-128k', name: 'ERNIE 3.5 128K', capabilities: ['function-call'], contextWindow: 131072 },
    { id: 'ernie-lite-8k', name: 'ERNIE Lite 8K', contextWindow: 8192 },
    { id: 'ernie-speed-128k', name: 'ERNIE Speed 128K', contextWindow: 131072 },
    { id: 'ernie-character-8k', name: 'ERNIE Character 8K', contextWindow: 8192 },
    { id: 'ernie-tiny-8k', name: 'ERNIE Tiny 8K', contextWindow: 8192 }
  ]
})
