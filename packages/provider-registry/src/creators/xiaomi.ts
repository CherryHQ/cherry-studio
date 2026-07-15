import { defineCreator } from './types'

export default defineCreator({
  id: 'xiaomi',
  name: 'Xiaomi (MiMo)',
  modelsDevProviders: ['xiaomi'],
  families: ['mimo'],
  idPrefixes: ['mimo'],
  reasoningMembership: ['mimo-v2[.-]5(?:-pro)?(?!-)|mimo-v2-(?:flash|pro|omni)'],
  reasoningFamilies: [
    { pattern: 'mimo-v2[.-]5(?:-pro)?(?!-)|mimo-v2-(?:flash|pro|omni)', toggle: true },
    { pattern: 'mimo-v2[.-]5(?:-pro)?(?!-)', budget: { min: 0, max: 30720 } },
    { pattern: 'mimo-v2-(?:flash|pro|omni)', budget: { min: 0, max: 30720 } }
  ]
})
