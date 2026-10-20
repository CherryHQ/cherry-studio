import type { ModelCapability, Modality } from '../schemas/enums'
import type { ReasoningSupport } from '../schemas/model'
import { defineCreator } from './types'

const OMNI_CAPABILITIES: ModelCapability[] = [
  'function-call',
  'reasoning',
  'image-recognition',
  'audio-recognition',
  'video-recognition',
  'structured-output',
  'file-input'
]
const OMNI_INPUTS: Modality[] = ['text', 'image', 'audio', 'video']
// Official API exposes thinking as on/off only; OpenRouter's effort ladder is gateway-side.
const TOGGLE_ONLY: ReasoningSupport = { controls: [{ kind: 'toggle' }] }

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
    },
    {
      id: 'mimo-v2-6-flash',
      name: 'MiMo-V2.6-Flash',
      capabilities: OMNI_CAPABILITIES,
      inputModalities: OMNI_INPUTS,
      outputModalities: ['text'],
      contextWindow: 1048576,
      maxOutputTokens: 131072,
      reasoning: TOGGLE_ONLY
    },
    {
      id: 'mimo-v2-6-pro',
      name: 'MiMo-V2.6-Pro',
      capabilities: OMNI_CAPABILITIES,
      inputModalities: OMNI_INPUTS,
      outputModalities: ['text'],
      contextWindow: 1048576,
      maxOutputTokens: 131072,
      reasoning: TOGGLE_ONLY
    },
    {
      id: 'mimo-v2-6-pro-ultraspeed',
      name: 'MiMo-V2.6-Pro-UltraSpeed',
      capabilities: OMNI_CAPABILITIES,
      inputModalities: OMNI_INPUTS,
      outputModalities: ['text'],
      contextWindow: 1048576,
      maxOutputTokens: 131072,
      reasoning: TOGGLE_ONLY
    }
  ],
  reasoningFamilies: [
    {
      pattern: 'mimo-v2[.-]5(?:-pro)?(?!-)|mimo-v2[.-]6-(?:flash|pro|pro-ultraspeed)(?!-)|mimo-v2-(?:flash|pro|omni)',
      toggle: true
    },
    // Membership profile (no knobs): suffixed variant the toggle rule's (?!-) guard excludes.
    { pattern: 'mimo-v2[.-]5-pro-ultraspeed' }
  ]
})
