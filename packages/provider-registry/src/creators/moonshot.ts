import { openaiCompatible } from './_api'
import { defineCreator } from './types'

export default defineCreator({
  id: 'moonshot',
  name: 'Moonshot AI (Kimi)',
  fetchModels: openaiCompatible('moonshot', 'MOONSHOT_API_KEY'),
  modelsDevProviders: ['moonshotai', 'moonshotai-cn'],
  families: ['kimi'],
  idPrefixes: ['kimi', 'moonshot'],
  reasoningFamilies: [
    // K2.7-code only accepts thinking type 'enabled' (platform.kimi.com
    // claude-code guide: requests without it are rejected) — always-on, the
    // explicit `toggle: false` stops the generic toggle below.
    { pattern: '^kimi-k2[.-]7-code', toggle: false },
    // K3 supports low/high/max thinking effort and can disable thinking; K3 Fast
    // exposes the same effort vocabulary but is always-on.
    { pattern: '^kimi-k3$', effort: ['low', 'high', 'max'], toggle: true },
    { pattern: '^kimi-k3-fast$', effort: ['low', 'high', 'max'] },
    // Kimi K2.5+ exposes the thinking toggle; kimi-k2-thinking is always-on.
    { pattern: '^kimi-k2[.-][5-9]\\d*', toggle: true },
    // The thinking budget is a K2.x-era knob — K3 controls depth via
    // `reasoning_effort` only (platform.kimi.com thinking-effort guide).
    { pattern: 'kimi-k2[.-][5-9]\\d*', budget: { min: 0, max: 30720 }, template: true },
    // Membership profiles (no knobs): reasoning SKUs beyond the knob rules above.
    { pattern: '^kimi-k2-thinking(?:-turbo)?$|^kimi-k(?:2[.-][5-9]\\d*|[3-9]\\d*(?:[.-]\\d+)?)(?:-[\\w-]+)?$' }
  ],
  models: [
    {
      id: 'kimi-k2',
      name: 'Kimi K2 Thinking',
      capabilities: ['function-call', 'reasoning', 'structured-output'],
      inputModalities: ['text'],
      outputModalities: ['text'],
      contextWindow: 262144,
      maxOutputTokens: 216144,
      messageCompatibility: { dynamicToolDeclarations: false }
    },
    {
      id: 'kimi-k2-5',
      name: 'Kimi K2.5',
      capabilities: [
        'function-call',
        'reasoning',
        'image-recognition',
        'video-recognition',
        'structured-output',
        'file-input'
      ],
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['text'],
      contextWindow: 262144,
      maxOutputTokens: 262144,
      messageCompatibility: { dynamicToolDeclarations: false }
    },
    {
      id: 'kimi-k2-6',
      name: 'Kimi K2.6',
      capabilities: [
        'function-call',
        'reasoning',
        'image-recognition',
        'video-recognition',
        'structured-output',
        'file-input'
      ],
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['text'],
      contextWindow: 262144,
      maxOutputTokens: 262144,
      messageCompatibility: { dynamicToolDeclarations: false }
    },
    {
      id: 'kimi-k2-7-code',
      name: 'Kimi K2.7 Code',
      capabilities: [
        'function-call',
        'reasoning',
        'image-recognition',
        'video-recognition',
        'structured-output',
        'file-input'
      ],
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['text'],
      contextWindow: 262144,
      maxOutputTokens: 262144,
      messageCompatibility: { dynamicToolDeclarations: false }
    },
    {
      id: 'kimi-k2-7-code-highspeed',
      name: 'Kimi K2.7 Code HighSpeed',
      capabilities: [
        'function-call',
        'reasoning',
        'image-recognition',
        'video-recognition',
        'structured-output',
        'file-input'
      ],
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['text'],
      contextWindow: 262144,
      maxOutputTokens: 262144,
      messageCompatibility: { dynamicToolDeclarations: false }
    },
    {
      id: 'kimi-k2-instruct',
      name: 'Kimi K2 0905',
      capabilities: ['function-call'],
      inputModalities: ['text'],
      outputModalities: ['text'],
      contextWindow: 262144,
      maxOutputTokens: 262144,
      messageCompatibility: { dynamicToolDeclarations: false }
    },
    {
      id: 'kimi-k2-thinking-maas',
      name: 'Kimi K2 Thinking',
      capabilities: ['function-call', 'reasoning', 'structured-output'],
      inputModalities: ['text'],
      outputModalities: ['text'],
      contextWindow: 262144,
      maxOutputTokens: 262144,
      messageCompatibility: { dynamicToolDeclarations: false }
    },
    {
      id: 'kimi-latest',
      name: 'MoonshotAI: Kimi Latest',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'video-recognition', 'structured-output'],
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['text'],
      contextWindow: 1048576,
      messageCompatibility: { dynamicToolDeclarations: false }
    },
    {
      id: 'kimi-k3',
      name: 'Kimi K3',
      capabilities: [
        'function-call',
        'reasoning',
        'image-recognition',
        'video-recognition',
        'structured-output',
        'file-input'
      ],
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['text'],
      contextWindow: 1048576,
      maxOutputTokens: 1048576,
      messageCompatibility: { dynamicToolDeclarations: true }
    },
    {
      id: 'kimi-k3-fast',
      name: 'Kimi K3 Fast',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'structured-output', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 1000000,
      maxOutputTokens: 131072,
      messageCompatibility: { dynamicToolDeclarations: true }
    }
  ]
})
