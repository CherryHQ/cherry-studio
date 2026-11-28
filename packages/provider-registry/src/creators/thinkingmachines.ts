import { type CreatorModel, defineCreator } from './types'

const inkling = {
  family: 'inkling',
  capabilities: ['function-call', 'reasoning', 'image-recognition', 'structured-output', 'file-input'],
  inputModalities: ['text', 'image'],
  outputModalities: ['text'],
  contextWindow: 1048576,
  openWeights: true
} satisfies Omit<CreatorModel, 'id'>

export default defineCreator({
  id: 'thinkingmachines',
  name: 'Thinking Machines Lab',
  idPrefixes: ['inkling'],
  reasoningFamilies: [{ pattern: '^inkling(?:-|$)' }],
  models: [
    {
      ...inkling,
      id: 'inkling',
      name: 'Inkling',
      capabilities: [...inkling.capabilities, 'audio-recognition'],
      inputModalities: ['text', 'image', 'audio']
    },
    {
      ...inkling,
      id: 'inkling-small',
      name: 'Inkling Small',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'audio-recognition', 'file-input'],
      inputModalities: ['text', 'image', 'audio']
    },
    { ...inkling, id: 'inkling-2-mini', name: 'Inkling 2 Mini' },
    { ...inkling, id: 'inkling-2-small', name: 'Inkling 2 Small' }
  ]
})
