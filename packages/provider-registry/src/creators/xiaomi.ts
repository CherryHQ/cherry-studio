import { defineCreator } from './types'

export default defineCreator({
  id: 'xiaomi',
  name: 'Xiaomi (MiMo)',
  modelsDevProviders: ['xiaomi'],
  families: ['mimo'],
  idPrefixes: ['mimo'],
  reasoningFamilies: [
    { pattern: 'mimo-v2[.-]5(?:-pro)?(?!-)|mimo-v2-(?:flash|pro|omni)', toggle: true },
    { pattern: 'mimo-v2[.-]5(?:-pro)?(?!-)', budget: { min: 0, max: 30720 }, template: true },
    { pattern: 'mimo-v2-(?:flash|pro|omni)', budget: { min: 0, max: 30720 }, template: true },
    // Membership profile (no knobs): suffixed variant the toggle rule's (?!-) guard excludes.
    { pattern: 'mimo-v2[.-]5-pro-ultraspeed' }
  ]
})
