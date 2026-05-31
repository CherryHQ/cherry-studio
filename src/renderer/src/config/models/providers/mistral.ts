import type { Model } from '@renderer/types'

export const mistralModels: Model[] = [
  {
    id: 'pixtral-12b-2409',
    provider: 'mistral',
    name: 'Pixtral 12B [Free]',
    group: 'Pixtral'
  },
  {
    id: 'pixtral-large-latest',
    provider: 'mistral',
    name: 'Pixtral Large',
    group: 'Pixtral'
  },
  {
    id: 'ministral-3b-latest',
    provider: 'mistral',
    name: 'Mistral 3B [Free]',
    group: 'Mistral Mini'
  },
  {
    id: 'ministral-8b-latest',
    provider: 'mistral',
    name: 'Mistral 8B [Free]',
    group: 'Mistral Mini'
  },
  {
    id: 'codestral-latest',
    provider: 'mistral',
    name: 'Mistral Codestral',
    group: 'Mistral Code'
  },
  {
    id: 'mistral-large-latest',
    provider: 'mistral',
    name: 'Mistral Large',
    group: 'Mistral Chat'
  },
  {
    id: 'mistral-small-latest',
    provider: 'mistral',
    name: 'Mistral Small',
    group: 'Mistral Chat'
  },
  {
    id: 'open-mistral-nemo',
    provider: 'mistral',
    name: 'Mistral Nemo',
    group: 'Mistral Chat'
  },
  {
    id: 'mistral-embed',
    provider: 'mistral',
    name: 'Mistral Embedding',
    group: 'Mistral Embed'
  }
]
