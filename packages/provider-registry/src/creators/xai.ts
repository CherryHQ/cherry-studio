import { openaiCompatible } from './_api'
import { defineCreator } from './types'

export default defineCreator({
  id: 'xai',
  name: 'xAI',
  fetchModels: openaiCompatible('grok', 'XAI_API_KEY'),
  modelsDevProviders: ['xai'],
  idPrefixes: ['grok'],
  models: [
    {
      id: 'grok-4',
      name: 'Grok 4',
      capabilities: ['reasoning', 'function-call', 'image-recognition'],
      contextWindow: 256000
    },
    { id: 'grok-4-fast', name: 'Grok 4 Fast', capabilities: ['reasoning', 'function-call'], contextWindow: 2000000 },
    { id: 'grok-4-1', name: 'Grok 4.1', capabilities: ['reasoning', 'function-call'], contextWindow: 256000 },
    { id: 'grok-code-fast-1', name: 'Grok Code Fast 1', capabilities: ['function-call'], contextWindow: 256000 },
    { id: 'grok-3', name: 'Grok 3', capabilities: ['function-call'], contextWindow: 131072 },
    { id: 'grok-3-fast', name: 'Grok 3 Fast', capabilities: ['function-call'], contextWindow: 131072 },
    { id: 'grok-3-mini', name: 'Grok 3 Mini', capabilities: ['reasoning', 'function-call'], contextWindow: 131072 },
    {
      id: 'grok-3-mini-fast',
      name: 'Grok 3 Mini Fast',
      capabilities: ['reasoning', 'function-call'],
      contextWindow: 131072
    },
    { id: 'grok-2', name: 'Grok 2', capabilities: ['function-call'], contextWindow: 131072 },
    {
      id: 'grok-2-vision',
      name: 'Grok 2 Vision',
      capabilities: ['function-call', 'image-recognition'],
      inputModalities: ['text', 'image'],
      contextWindow: 32768
    },
    { id: 'grok-beta', name: 'Grok Beta', capabilities: ['function-call'], contextWindow: 131072 },
    {
      id: 'grok-vision-beta',
      name: 'Grok Vision Beta',
      capabilities: ['image-recognition'],
      inputModalities: ['text', 'image'],
      contextWindow: 8192
    }
  ]
})
