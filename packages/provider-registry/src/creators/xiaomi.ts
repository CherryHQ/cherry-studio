import { defineCreator } from './types'

export default defineCreator({
  id: 'xiaomi',
  name: 'Xiaomi (MiMo)',
  modelsDevProviders: ['xiaomi'],
  families: ['mimo'],
  idPrefixes: ['mimo'],
  reasoningFamilies: [
    { pattern: 'mimo-v2[.-]5(?:-pro)?(?!-)|mimo-v2-(?:flash|pro|omni)', toggle: true },
    // Membership profile (no knobs): suffixed variant the toggle rule's (?!-) guard excludes.
    { pattern: 'mimo-v2[.-]5-pro-ultraspeed' }
  ]
})
