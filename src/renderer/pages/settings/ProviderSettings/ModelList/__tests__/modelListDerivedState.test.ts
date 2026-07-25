import type { ModelWithStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { HealthStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import {
  applyModelFilters,
  calculateModelListDerivedState,
  countModelsInGroups,
  groupModels,
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
  it('groups filtered models into sorted unified groups', () => {
    const groups = groupModels(applyModelFilters(models as any, '', 'all'))

    expect(Object.keys(groups)).toEqual(['chat', 'embedding', 'reasoning', 'rerank', 'vision'])
    expect(countModelsInGroups(groups)).toBe(5)
  })

  it('uses model id group names before model.group', () => {
    const groupedModels = [
      {
        id: 'provider::openai/gpt-4o',
        apiModelId: 'openai/gpt-4o',
        name: 'GPT 4o',
        providerId: 'provider',
        group: 'provider-group',
        capabilities: [],
        isEnabled: true
      },
      {
        id: 'provider::deepseek-v3',
        apiModelId: 'deepseek-v3',
        name: 'DeepSeek V3',
        providerId: 'provider',
        group: 'aihubmix',
        capabilities: [],
        isEnabled: true
      }
    ]

    expect(Object.keys(groupModels(groupedModels as any))).toEqual(['deepseek', 'openai'])
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
    // 'text' (language) excludes the embedding kind even when it matches the search.
    expect(applyModelFilters(models as any, 'alpha', 'text').map((model) => model.id)).toEqual([
      'openai::reasoning-free',
      'openai::vision-alpha'
    ])
  })

  it('separates generated audio from text-to-speech via the TTS endpoint', () => {
    const audioModels = [
      {
        id: 'x::musicgen',
        name: 'MusicGen',
        providerId: 'x',
        capabilities: [MODEL_CAPABILITY.AUDIO_GENERATION],
        endpointTypes: [],
        isEnabled: true
      },
      {
        id: 'x::tts',
        name: 'TTS',
        providerId: 'x',
        capabilities: [MODEL_CAPABILITY.AUDIO_GENERATION],
        endpointTypes: [ENDPOINT_TYPE.OPENAI_TEXT_TO_SPEECH],
        isEnabled: true
      }
    ] as any[]

    expect(applyModelFilters(audioModels, '', 'audio').map((model) => model.id)).toEqual(['x::musicgen'])
    expect(applyModelFilters(audioModels, '', 'speech').map((model) => model.id)).toEqual(['x::tts'])
  })

  it('matches separator-insensitive model ids in provider settings search', () => {
    const searchModels = [
      {
        id: 'openai::gpt-4',
        name: 'GPT-4',
        providerId: 'openai',
        capabilities: [],
        isEnabled: true
      }
    ]

    expect(applyModelFilters(searchModels as any, 'gpt4', 'all').map((model) => model.id)).toEqual(['openai::gpt-4'])
  })

  it('ranks token-initial abbreviations before loose provider settings model matches', () => {
    const searchModels = [
      {
        id: 'siliconflow::funaudio-cosyvoice',
        name: 'FunAudioLLM/CosyVoice2-0.5',
        providerId: 'siliconflow',
        group: 'FunAudioLLM',
        capabilities: [],
        isEnabled: true
      },
      {
        id: 'siliconflow::deepseek-v3',
        name: 'Pro/deepseek-ai/DeepSeek-V3',
        providerId: 'siliconflow',
        group: 'Pro',
        capabilities: [],
        isEnabled: true
      }
    ]

    expect(applyModelFilters(searchModels as any, 'dsv', 'all').map((model) => model.id)).toEqual([
      'siliconflow::deepseek-v3',
      'siliconflow::funaudio-cosyvoice'
    ])

    expect(Object.keys(groupModels(applyModelFilters(searchModels as any, 'dsv', 'all'), true))).toEqual([
      'deepseek',
      'funaudio'
    ])
  })

  it('ranks model-name initials before short description matches', () => {
    const searchModels = [
      {
        id: 'zai::glm-air',
        name: 'zai-org/GLM-4.5-Air',
        providerId: 'zai',
        group: 'zai-org',
        description: 'A fast model family for agent workflows.',
        capabilities: [],
        isEnabled: true
      },
      {
        id: 'siliconflow::funaudio-cosyvoice',
        name: 'FunAudioLLM/CosyVoice2-0.5',
        providerId: 'siliconflow',
        group: 'FunAudioLLM',
        capabilities: [],
        isEnabled: true
      }
    ]

    expect(applyModelFilters(searchModels as any, 'fa', 'all').map((model) => model.id)).toEqual([
      'siliconflow::funaudio-cosyvoice',
      'zai::glm-air'
    ])
  })

  it('derives counts, booleans, and status map', () => {
    const modelStatuses: ModelWithStatus[] = [
      {
        kind: 'ok',
        model: models[0],
        status: HealthStatus.SUCCESS,
        keyResults: [],
        checking: false,
        latency: 120
      }
    ]

    const derivedState = calculateModelListDerivedState({
      models: models as any,
      searchText: '',
      selectedCapabilityFilter: 'all',
      modelStatuses
    })

    expect(derivedState.modelCount).toBe(5)
    expect(derivedState.hasVisibleModels).toBe(true)
    expect(derivedState.hasNoModels).toBe(false)
    expect(derivedState.capabilityOptions).toEqual(MODEL_LIST_CAPABILITY_FILTERS)
    expect(derivedState.capabilityModelCounts).toEqual({
      all: 5,
      text: 3,
      image: 0,
      embedding: 1,
      audio: 0,
      video: 0,
      rerank: 1,
      speech: 0,
      transcription: 0
    })
    expect(derivedState.duplicateModelNames.has('Alpha')).toBe(true)
    expect(derivedState.modelStatusMap.get('openai::reasoning-free')).toEqual(modelStatuses[0])
  })

  it('applies search but not the selected type filter to tab counts', () => {
    const derivedState = calculateModelListDerivedState({
      models: models as any,
      searchText: 'alpha',
      selectedCapabilityFilter: 'embedding',
      modelStatuses: []
    })

    expect(derivedState.filteredModels.map((model) => model.id)).toEqual(['openai::embedding-alpha'])
    expect(derivedState.capabilityModelCounts).toEqual({
      all: 3,
      text: 2,
      image: 0,
      embedding: 1,
      audio: 0,
      video: 0,
      rerank: 0,
      speech: 0,
      transcription: 0
    })
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
    expect(derivedState.capabilityOptions).toEqual(MODEL_LIST_CAPABILITY_FILTERS)
    expect(derivedState.capabilityModelCounts).toEqual({
      all: 0,
      text: 0,
      image: 0,
      embedding: 0,
      audio: 0,
      video: 0,
      rerank: 0,
      speech: 0,
      transcription: 0
    })
  })
})
