import { defineCreator } from './types'

export default defineCreator({
  id: 'xiaomi',
  name: 'Xiaomi (MiMo)',
  modelsDevProviders: ['xiaomi'],
  families: ['mimo'],
  idPrefixes: ['mimo'],
  models: [
    {
      id: 'mimo-v2-5',
      name: 'MiMo-V2.5',
      capabilities: [
        'function-call',
        'reasoning',
        'image-recognition',
        'audio-recognition',
        'video-recognition',
        'structured-output',
        'file-input'
      ],
      inputModalities: ['text', 'image', 'audio', 'video'],
      outputModalities: ['text'],
      maxOutputTokens: 131072
    }
  ],
  reasoningFamilies: [
    { pattern: 'mimo-v2[.-]5(?:-pro)?(?!-)|mimo-v2-(?:flash|pro|omni)', toggle: true },
    // Membership profile (no knobs): suffixed variant the toggle rule's (?!-) guard excludes.
    { pattern: 'mimo-v2[.-]5-pro-ultraspeed' }
  ]
})
