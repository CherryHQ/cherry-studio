import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_CATALOG_MY_TAB,
  buildAssistantCatalogTabs,
  filterAssistantCatalogPresets,
  getAssistantPresetCatalogKey,
  toCreateAssistantDtoFromCatalogPreset
} from '../useAssistantPresetCatalog'

describe('assistant preset catalog helpers', () => {
  it('keeps my assistants first and orders known system groups before custom groups', () => {
    const tabs = buildAssistantCatalogTabs(
      [
        { name: 'Business helper', group: ['Business'] },
        { name: 'Career helper', group: ['Career'] },
        { name: 'Custom helper', group: ['Custom'] }
      ],
      2,
      'Mine'
    )

    expect(tabs.map((tab) => tab.id)).toEqual([ASSISTANT_CATALOG_MY_TAB, 'Career', 'Business', 'Custom'])
    expect(tabs.map((tab) => tab.count)).toEqual([2, 1, 1, 1])
  })

  it('filters only the active system group by name or description', () => {
    const presets = filterAssistantCatalogPresets(
      [
        { name: 'Product Manager', description: 'Plan requirements', group: ['Career'] },
        { name: 'Marketing Planner', description: 'Campaign ideas', group: ['Business'] },
        { name: 'Research Writer', description: 'Long-form product analysis', group: ['Career'] }
      ],
      'Career',
      'product'
    )

    expect(presets.map((preset) => preset.name)).toEqual(['Product Manager', 'Research Writer'])
    expect(filterAssistantCatalogPresets(presets, ASSISTANT_CATALOG_MY_TAB, 'product')).toEqual([])
  })

  it('builds a DataApi create payload from a catalog preset without legacy fields', () => {
    const dto = toCreateAssistantDtoFromCatalogPreset({
      name: 'Product Manager',
      prompt: 'You are a product manager.',
      description: 'Plan requirements',
      emoji: '🧑‍💼',
      group: ['Career'],
      defaultModel: {
        id: 'gpt-4o',
        provider: 'openai',
        name: 'GPT-4o',
        group: 'OpenAI'
      }
    })

    expect(dto).toEqual({
      name: 'Product Manager',
      prompt: 'You are a product manager.',
      description: 'Plan requirements',
      emoji: '🧑‍💼',
      modelId: 'openai::gpt-4o'
    })
  })

  it('uses name and prompt as the stable catalog key', () => {
    expect(getAssistantPresetCatalogKey({ name: 'A', prompt: 'P', description: 'D' })).toBe('A\nP')
    expect(getAssistantPresetCatalogKey({ name: 'A', description: 'D' })).toBe('A\nD')
  })
})
