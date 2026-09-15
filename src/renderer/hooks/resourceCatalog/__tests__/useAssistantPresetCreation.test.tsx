import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAssistant: vi.fn(),
  defaultModelId: null as string | null,
  models: [] as any[],
  modelsLoading: false,
  providers: [] as any[],
  providersLoading: false
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [mocks.defaultModelId, vi.fn()]
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({ models: mocks.models, isLoading: mocks.modelsLoading })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: mocks.providers, isLoading: mocks.providersLoading })
}))

vi.mock('../assistantAdapter', () => ({
  useAssistantMutations: () => ({ createAssistant: mocks.createAssistant })
}))

import { useAssistantPresetCreation } from '../useAssistantPresetCreation'

function configuredProvider(id: string) {
  return {
    id,
    name: id,
    apiKeys: [{ id: `${id}-key`, isEnabled: true }],
    authType: 'api-key',
    settings: {},
    reportsActualCost: false,
    isEnabled: true
  }
}

function enabledModel(providerId: string, apiModelId: string) {
  return {
    id: `${providerId}::${apiModelId}`,
    providerId,
    apiModelId,
    name: apiModelId,
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  }
}

describe('useAssistantPresetCreation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.defaultModelId = null
    mocks.models = []
    mocks.modelsLoading = false
    mocks.providers = []
    mocks.providersLoading = false
    mocks.createAssistant.mockResolvedValue({ id: 'assistant-created', name: 'Claude' })
  })

  it('materializes an official preset as a normal assistant with the resolved vendor model', async () => {
    mocks.providers = [configuredProvider('anthropic')]
    mocks.models = [enabledModel('anthropic', 'claude-opus-4-1'), enabledModel('anthropic', 'claude-sonnet-4-6')]
    const { result } = renderHook(() => useAssistantPresetCreation())

    let creationResult: Awaited<ReturnType<typeof result.current.createFromPreset>> | undefined
    await act(async () => {
      creationResult = await result.current.createFromPreset({
        id: 'official-claude',
        name: 'Claude',
        description: 'Anthropic assistant',
        emoji: '🟠',
        prompt: 'Today is {{date}}.',
        officialVendor: 'anthropic'
      })
    })

    expect(mocks.createAssistant).toHaveBeenCalledWith({
      name: 'Claude',
      description: 'Anthropic assistant',
      emoji: '🟠',
      prompt: 'Today is {{date}}.',
      modelId: 'anthropic::claude-sonnet-4-6'
    })
    expect(creationResult).toEqual({
      status: 'created',
      assistant: { id: 'assistant-created', name: 'Claude' }
    })
  })

  it('returns configuration guidance without writing when no vendor model is available', async () => {
    const { result } = renderHook(() => useAssistantPresetCreation())

    let creationResult: Awaited<ReturnType<typeof result.current.createFromPreset>> | undefined
    await act(async () => {
      creationResult = await result.current.createFromPreset({
        id: 'official-chatgpt',
        name: 'ChatGPT',
        officialVendor: 'openai'
      })
    })

    expect(mocks.createAssistant).not.toHaveBeenCalled()
    expect(creationResult).toEqual({ status: 'configuration-required', providerId: 'openai' })
  })

  it('preserves the existing create behavior for community presets', async () => {
    const { result } = renderHook(() => useAssistantPresetCreation())

    await act(async () => {
      await result.current.createFromPreset({ id: 'community', name: ' Product Manager ', prompt: ' Help. ' })
    })

    expect(mocks.createAssistant).toHaveBeenCalledWith({ name: 'Product Manager', prompt: 'Help.' })
  })

  it('materializes independent assistants when the same preset is added twice', async () => {
    const { result } = renderHook(() => useAssistantPresetCreation())
    const preset = { id: 'community', name: 'Product Manager', prompt: 'Help.' }

    await act(async () => {
      await result.current.createFromPreset(preset)
      await result.current.createFromPreset(preset)
    })

    expect(mocks.createAssistant).toHaveBeenCalledTimes(2)
  })

  it('exposes provider and model loading as one resolution state', () => {
    mocks.modelsLoading = true
    const { result } = renderHook(() => useAssistantPresetCreation())

    expect(result.current.isLoading).toBe(true)
  })
})
