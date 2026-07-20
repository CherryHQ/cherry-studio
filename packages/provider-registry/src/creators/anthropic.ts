import { anthropicModels } from './_api'
import { defineCreator } from './types'

export default defineCreator({
  id: 'anthropic',
  name: 'Anthropic',
  fetchModels: anthropicModels(),
  modelsDevProviders: ['anthropic'],
  idPrefixes: ['claude'],
  reasoningFamilies: [
    // Adaptive-effort generations: 4.6+ minors, the 5.x/Fable line, and the
    // -latest aliases (which track the newest flagship).
    {
      pattern:
        '^(?:anthropic\\.)?claude-(?:(?:opus|sonnet|haiku)-(?:4[.-][6-9]|[5-9])(?!\\d)|(?:opus|sonnet|haiku)-latest|fable)',
      // 'auto' = adaptive without an effort tier — the model decides (docs:
      // adaptive-thinking); joins upstream vocabularies via the mode union.
      effort: ['low', 'medium', 'high', 'max', 'auto'],
      toggle: true
    },
    // Pre-adaptive thinking SKUs: on/off + budget (tiers below).
    { pattern: '^(?:anthropic\\.)?claude', toggle: true, template: true },
    {
      pattern: '(?:anthropic\\.)?claude-opus-4[.-]7(?:[@\\-:][\\w\\-:]+)?$',
      budget: { min: 1024, max: 128000 },
      template: true
    },
    {
      pattern: '(?:anthropic\\.)?claude-opus-4[.-]6(?:[@\\-:][\\w\\-:]+)?$',
      budget: { min: 1024, max: 128000 },
      template: true
    },
    {
      pattern: '(?:anthropic\\.)?claude-(:?sonnet|haiku)-4[.-]6.*(?:-v\\d+:\\d+)?$',
      budget: { min: 1024, max: 64000 },
      template: true
    },
    {
      pattern: '(?:anthropic\\.)?claude-(:?haiku|sonnet|opus)-4[.-]5.*(?:-v\\d+:\\d+)?$',
      budget: { min: 1024, max: 64000 },
      template: true
    },
    {
      pattern: '(?:anthropic\\.)?claude-opus-4[.-]1.*(?:-v\\d+:\\d+)?$',
      budget: { min: 1024, max: 32000 },
      template: true
    },
    {
      pattern: '(?:anthropic\\.)?claude-sonnet-4(?:[.-]0)?(?:[@-](?:\\d{4,}|[a-z][\\w-]*))?(?:-v\\d+:\\d+)?$',
      budget: { min: 1024, max: 64000 },
      template: true
    },
    {
      pattern: '(?:anthropic\\.)?claude-opus-4(?:[.-]0)?(?:[@-](?:\\d{4,}|[a-z][\\w-]*))?(?:-v\\d+:\\d+)?$',
      budget: { min: 1024, max: 32000 },
      template: true
    },
    {
      pattern: '(?:anthropic\\.)?claude-3[.-]7.*sonnet.*(?:-v\\d+:\\d+)?$',
      budget: { min: 1024, max: 64000 },
      template: true
    },
    // Membership profiles (no knobs): reasoning SKUs beyond the knob rules above.
    { pattern: 'claude-3-7-sonnet|claude-3\\.7-sonnet' },
    { pattern: 'claude-(?:sonnet|opus|haiku)-4' }
  ],
  webSearch: [
    'claude-opus-4',
    'claude-sonnet-4',
    'claude-haiku-4',
    'claude-3-5-haiku',
    'claude-3-5-sonnet',
    'claude-3-7-sonnet'
  ]
})
