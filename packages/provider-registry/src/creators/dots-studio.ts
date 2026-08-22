import { defineCreator } from './types'

export default defineCreator({
  id: 'dots-studio',
  name: 'Dots Studio',
  idPrefixes: ['dots-3'],
  reasoningFamilies: [{ pattern: '^dots-3-note-preview$', toggle: true }],
  models: [
    {
      id: 'dots-3-note-preview',
      name: 'Dots3-Note Preview',
      description:
        'Dots3-Note Preview is an open-weight multimodal mixture-of-experts model with 16B active parameters out of 280B total, built for reasoning, tool use, coding, agent workflows, and long-context understanding.',
      family: 'dots3',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'audio-recognition', 'video-recognition'],
      inputModalities: ['text', 'image', 'audio', 'video'],
      outputModalities: ['text'],
      contextWindow: 524_288,
      openWeights: true
    }
  ]
})
