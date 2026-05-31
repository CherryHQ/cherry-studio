import type { Model } from '@renderer/types'

export const moonshotModels: Model[] = [
  {
    id: 'moonshot-v1-auto',
    name: 'moonshot-v1-auto',
    provider: 'moonshot',
    group: 'moonshot-v1',
    owned_by: 'moonshot',
    capabilities: [{ type: 'text' }, { type: 'function_calling' }]
  },
  {
    id: 'kimi-k2-0711-preview',
    name: 'kimi-k2-0711-preview',
    provider: 'moonshot',
    group: 'kimi-k2',
    owned_by: 'moonshot',
    capabilities: [{ type: 'text' }, { type: 'function_calling' }],
    pricing: {
      input_per_million_tokens: 0.6,
      output_per_million_tokens: 2.5,
      currencySymbol: 'USD'
    }
  },
  {
    id: 'kimi-k2.5',
    provider: 'moonshot',
    name: 'Kimi K2.5',
    group: 'Kimi K2.5',
    owned_by: 'moonshot',
    capabilities: [{ type: 'text' }, { type: 'vision' }, { type: 'function_calling' }]
  },
  {
    id: 'kimi-k2.6',
    provider: 'moonshot',
    name: 'Kimi K2.6',
    group: 'Kimi K2.6',
    owned_by: 'moonshot',
    capabilities: [{ type: 'text' }, { type: 'vision' }, { type: 'function_calling' }]
  },
  {
    id: 'kimi-k2-0905-Preview',
    provider: 'moonshot',
    name: 'Kimi K2 0905 Preview',
    group: 'Kimi K2',
    owned_by: 'moonshot',
    capabilities: [{ type: 'text' }, { type: 'function_calling' }]
  },
  {
    id: 'kimi-k2-turbo-preview',
    provider: 'moonshot',
    name: 'Kimi K2 Turbo Preview',
    group: 'Kimi K2',
    owned_by: 'moonshot',
    capabilities: [{ type: 'text' }, { type: 'function_calling' }]
  },
  {
    id: 'kimi-k2-thinking',
    provider: 'moonshot',
    name: 'Kimi K2 Thinking',
    group: 'Kimi K2 Thinking',
    owned_by: 'moonshot',
    capabilities: [{ type: 'text' }, { type: 'function_calling' }]
  },
  {
    id: 'kimi-k2-thinking-turbo',
    provider: 'moonshot',
    name: 'Kimi K2 Thinking Turbo',
    group: 'Kimi K2 Thinking',
    owned_by: 'moonshot',
    capabilities: [{ type: 'text' }, { type: 'function_calling' }]
  }
]
