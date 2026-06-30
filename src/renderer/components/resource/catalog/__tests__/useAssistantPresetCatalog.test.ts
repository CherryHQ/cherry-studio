import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const assistantCatalogMocks = vi.hoisted(() => ({
  language: 'en-US',
  read: vi.fn(),
  resourcesPath: '/resources'
}))

vi.mock('@data/hooks/useCache', () => ({
  useCache: () => [assistantCatalogMocks.resourcesPath]
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: assistantCatalogMocks.language },
    t: (key: string) => key
  })
}))

import { useAssistantCatalogPresets } from '@renderer/hooks/useAssistantCatalogPresets'

import {
  ASSISTANT_CATALOG_MY_TAB,
  buildAssistantCatalogTabs,
  filterAssistantCatalogPresets,
  getAssistantPresetCatalogKey,
  toCreateAssistantDtoFromCatalogPreset
} from '../useAssistantPresetCatalog'

describe('assistant preset catalog helpers', () => {
  beforeEach(() => {
    assistantCatalogMocks.language = 'en-US'
    assistantCatalogMocks.read.mockReset()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        fs: {
          read: assistantCatalogMocks.read
        }
      }
    })
  })

  it('loads every local assistant catalog preset for picker reuse', async () => {
    assistantCatalogMocks.read.mockResolvedValue(
      JSON.stringify([
        { id: 'preset-product', name: 'Product Manager', group: ['Career'] },
        { id: 'invalid-missing-name' },
        { id: 'preset-business', name: 'Business Helper', group: ['Business'] }
      ])
    )

    const { result } = renderHook(() => useAssistantCatalogPresets())

    await waitFor(() => expect(result.current.presets).toHaveLength(2))
    expect(assistantCatalogMocks.read).toHaveBeenCalledWith('/resources/data/agents-en.json', 'utf-8')
    expect(result.current.presets.map((preset) => preset.id)).toEqual(['preset-product', 'preset-business'])
  })

  it('keeps my assistants first and orders known system groups before custom groups', () => {
    const tabs = buildAssistantCatalogTabs(
      [
        { id: 'preset-business', name: 'Business helper', group: ['Business'] },
        { id: 'preset-career', name: 'Career helper', group: ['Career'] },
        { id: 'preset-custom', name: 'Custom helper', group: ['Custom'] }
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
        { id: 'preset-product', name: 'Product Manager', description: 'Plan requirements', group: ['Career'] },
        { id: 'preset-marketing', name: 'Marketing Planner', description: 'Campaign ideas', group: ['Business'] },
        { id: 'preset-research', name: 'Research Writer', description: 'Long-form product analysis', group: ['Career'] }
      ],
      'Career',
      'product'
    )

    expect(presets.map((preset) => preset.name)).toEqual(['Product Manager', 'Research Writer'])
    expect(filterAssistantCatalogPresets(presets, ASSISTANT_CATALOG_MY_TAB, 'product')).toEqual([])
  })

  it('builds a DataApi create payload from a catalog preset without legacy fields', () => {
    const dto = toCreateAssistantDtoFromCatalogPreset({
      id: '550e8400-e29b-41d4-a716-446655440000',
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

  it('uses the preset id as the stable catalog key', () => {
    expect(getAssistantPresetCatalogKey({ id: '550e8400-e29b-41d4-a716-446655440000' })).toBe(
      '550e8400-e29b-41d4-a716-446655440000'
    )
  })
})
