import type { ModelWithStatus } from '@renderer/pages/settings/ProviderSettingsV2/types/healthCheck'
import { HealthStatus } from '@renderer/pages/settings/ProviderSettingsV2/types/healthCheck'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { isFunctionCallingModel, isGenerateImageModel, isVisionModel } from '../../config/models'
import {
  applyModelFilters,
  calculateModelListDerivedState,
  calculateModelSections,
  countModelsInGroups,
  MODEL_LIST_CAPABILITY_FILTERS
} from '../modelListDerivedState'

const models = [
  {
    id: 'openai::reasoning-free',
    name: 'Alpha Free',
    providerId: 'openai',
    group: 'chat',
    capabilities: [MODEL_CAPABILITY.REASONING],
    isEnabled: true
  },
  {
    id: 'openai::vision-alpha',
    name: 'Alpha',
    providerId: 'openai',
    group: undefined,
    capabilities: [MODEL_CAPABILITY.IMAGE_RECOGNITION],
    isEnabled: true
  },
  {
    id: 'openai::embedding-alpha',
    name: 'Alpha',
    providerId: 'openai',
    group: 'embedding',
    capabilities: [MODEL_CAPABILITY.EMBEDDING],
    isEnabled: false
  },
  {
    id: 'openai::tooling',
    name: 'Gamma',
    providerId: 'openai',
    group: 'chat',
    capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.WEB_SEARCH],
    isEnabled: true
  },
  {
    id: 'openai::ranker',
    name: 'Delta',
    providerId: 'openai',
    group: 'rerank',
    capabilities: [MODEL_CAPABILITY.RERANK],
    isEnabled: false
  }
] as any[]

describe('modelListDerivedState', () => {
  it('groups filtered models into sorted enabled and disabled sections', () => {
    const sections = calculateModelSections(models as any, '', 'all')

    expect(Object.keys(sections.enabled)).toEqual(['__ungrouped__', 'chat'])
    expect(Object.keys(sections.disabled)).toEqual(['embedding', 'rerank'])
    expect(countModelsInGroups(sections.enabled)).toBe(3)
    expect(countModelsInGroups(sections.disabled)).toBe(2)
  })

  it('applies search text and capability filters together', () => {
    expect(applyModelFilters(models as any, 'alpha', 'all').map((model) => model.id)).toEqual([
      'openai::reasoning-free',
      'openai::vision-alpha',
      'openai::embedding-alpha'
    ])
    expect(applyModelFilters(models as any, 'alpha', 'embedding').map((model) => model.id)).toEqual([
      'openai::embedding-alpha'
    ])
    expect(applyModelFilters(models as any, 'free', 'reasoning').map((model) => model.id)).toEqual([
      'openai::reasoning-free'
    ])
  })

  it('derives counts, booleans, and status map', () => {
    const modelStatuses: ModelWithStatus[] = [
      {
        model: models[0],
        status: HealthStatus.SUCCESS,
        keyResults: [],
        latency: 120
      }
    ]

    const derivedState = calculateModelListDerivedState({
      models: models as any,
      searchText: '',
      selectedCapabilityFilter: 'all',
      modelStatuses
    })

    expect(derivedState.enabledModelCount).toBe(3)
    expect(derivedState.disabledModelCount).toBe(2)
    expect(derivedState.modelCount).toBe(5)
    expect(derivedState.hasVisibleModels).toBe(true)
    expect(derivedState.hasNoModels).toBe(false)
    expect(derivedState.allEnabled).toBe(false)
    expect(derivedState.capabilityOptions).toEqual(MODEL_LIST_CAPABILITY_FILTERS)
    expect(derivedState.capabilityModelCounts).toEqual({
      all: 5,
      reasoning: 1,
      vision: 1,
      websearch: 1,
      free: 1,
      embedding: 1,
      rerank: 1,
      function_calling: 1
    })
    expect(derivedState.duplicateModelNames.has('Alpha')).toBe(true)
    expect(derivedState.modelStatusMap.get('openai::reasoning-free')).toEqual(modelStatuses[0])
  })

  it('derives empty state and wide layout values without visible models', () => {
    const derivedState = calculateModelListDerivedState({
      models: [],
      searchText: 'missing',
      selectedCapabilityFilter: 'all',
      modelStatuses: []
    })

    expect(derivedState.hasNoModels).toBe(true)
    expect(derivedState.hasVisibleModels).toBe(false)
    expect(derivedState.modelCount).toBe(0)
    expect(derivedState.allEnabled).toBe(false)
    expect(derivedState.capabilityOptions).toEqual(MODEL_LIST_CAPABILITY_FILTERS)
    expect(derivedState.capabilityModelCounts).toEqual({
      all: 0,
      reasoning: 0,
      vision: 0,
      websearch: 0,
      free: 0,
      embedding: 0,
      rerank: 0,
      function_calling: 0
    })
  })

  it('keeps v2 capability regexes aligned for Kimi, Gemini image, GPT OSS, and MiMo variants', () => {
    expect(
      isVisionModel({ id: 'moonshot::kimi-k2.6', name: 'kimi-k2.6', providerId: 'moonshot', capabilities: [] })
    ).toBe(true)
    expect(
      isGenerateImageModel({
        id: 'google::gemini-3-flash-image-preview',
        name: 'gemini-3-flash-image-preview',
        providerId: 'google',
        capabilities: []
      })
    ).toBe(true)
    expect(
      isFunctionCallingModel({
        id: 'openai::gpt-oss',
        name: 'gpt-oss',
        providerId: 'openai',
        capabilities: []
      })
    ).toBe(true)
    expect(
      isFunctionCallingModel({
        id: 'mimo::mimo-v2.5-pro',
        name: 'mimo-v2.5-pro',
        providerId: 'mimo',
        capabilities: []
      })
    ).toBe(true)
  })
})
