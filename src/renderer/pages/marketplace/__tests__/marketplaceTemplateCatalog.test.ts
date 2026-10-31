import { describe, expect, it } from 'vitest'

import { buildMarketplaceTemplates } from '../marketplaceTemplateCatalog'

const original = {
  id: 'writer',
  name: { en: 'Writer', zh: '写作智能体' },
  description: { en: 'Writes', zh: '写作' },
  avatar: '✍️',
  category: 'Writing',
  instructions: 'Original instructions'
}

const assistant = {
  id: 'writer',
  name: 'Writing assistant',
  description: 'Assistant description',
  emoji: '📝',
  prompt: 'Keep this prompt\n{{language}}',
  group: ['Writing'],
  defaultModel: { provider: 'legacy', id: 'old-model' }
}

describe('merged marketplace templates', () => {
  it('keeps both sources when IDs overlap without dropping either template', () => {
    const templates = buildMarketplaceTemplates([original], [assistant], 'zh-CN')
    expect(templates.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'agent:writer', name: '写作智能体' },
      { id: 'assistant:writer', name: 'Writing assistant' }
    ])
    expect(templates[0].prompt).toBe('Original instructions')
    expect(templates[0].groups).toEqual(templates[1].groups)
  })

  it('preserves the assistant prompt and metadata without carrying over model settings', () => {
    const [template] = buildMarketplaceTemplates([], [assistant], 'en-US')
    expect(template).toEqual({
      id: 'assistant:writer',
      name: 'Writing assistant',
      description: 'Assistant description',
      avatar: '📝',
      prompt: 'Keep this prompt\n{{language}}',
      groups: ['写作']
    })
  })
})
