import { describe, expect, it } from 'vitest'

import { llmSlice, initialState } from '../llm'

describe('llmSlice', () => {
  it('should return the initial state', () => {
    expect(llmSlice.getInitialState()).toEqual(initialState)
  })

  it('should handle setDefaultModel', () => {
    const model = { id: 'test-model', name: 'Test Model', provider: 'test' }
    const state = llmSlice.reducer(initialState, llmSlice.actions.setDefaultModel(model))
    expect(state.defaultModel).toEqual(model)
  })

  it('should handle setTopicNamingModel', () => {
    const model = { id: 'test-model', name: 'Test Model', provider: 'test' }
    const state = llmSlice.reducer(initialState, llmSlice.actions.setTopicNamingModel(model))
    expect(state.topicNamingModel).toEqual(model)
  })

  it('should handle setQuickModel', () => {
    const model = { id: 'test-model', name: 'Test Model', provider: 'test' }
    const state = llmSlice.reducer(initialState, llmSlice.actions.setQuickModel(model))
    expect(state.quickModel).toEqual(model)
  })

  it('should handle setTranslateModel', () => {
    const model = { id: 'test-model', name: 'Test Model', provider: 'test' }
    const state = llmSlice.reducer(initialState, llmSlice.actions.setTranslateModel(model))
    expect(state.translateModel).toEqual(model)
  })

  it('should handle setQuickAssistantId', () => {
    const state = llmSlice.reducer(initialState, llmSlice.actions.setQuickAssistantId('test-id'))
    expect(state.quickAssistantId).toBe('test-id')
  })

  it('should handle updateProvider', () => {
    const provider = {
      id: 'test-provider',
      name: 'Test Provider',
      type: 'openai' as const,
      apiKey: 'test-key',
      apiHost: 'https://test.com',
      models: [],
      isSystem: false,
      enabled: true
    }
    const state = llmSlice.reducer(initialState, llmSlice.actions.updateProvider(provider))
    expect(state.providers.find((p) => p.id === 'test-provider')).toEqual(provider)
  })

  it('should handle addProvider', () => {
    const provider = {
      id: 'new-provider',
      name: 'New Provider',
      type: 'openai' as const,
      apiKey: 'test-key',
      apiHost: 'https://test.com',
      models: [],
      isSystem: false,
      enabled: true
    }
    const state = llmSlice.reducer(initialState, llmSlice.actions.addProvider(provider))
    expect(state.providers.find((p) => p.id === 'new-provider')).toEqual(provider)
  })

  it('should handle removeProvider', () => {
    const state = llmSlice.reducer(initialState, llmSlice.actions.removeProvider('openai'))
    expect(state.providers.find((p) => p.id === 'openai')).toBeUndefined()
  })

  it('should handle setOllamaKeepAliveTime', () => {
    const state = llmSlice.reducer(initialState, llmSlice.actions.setOllamaKeepAliveTime(5))
    expect(state.settings.ollama.keepAliveTime).toBe(5)
  })

  it('should handle setLmstudioKeepAliveTime', () => {
    const state = llmSlice.reducer(initialState, llmSlice.actions.setLmstudioKeepAliveTime(5))
    expect(state.settings.lmstudio.keepAliveTime).toBe(5)
  })

  it('should handle setGpustackKeepAliveTime', () => {
    const state = llmSlice.reducer(initialState, llmSlice.actions.setGpustackKeepAliveTime(5))
    expect(state.settings.gpustack.keepAliveTime).toBe(5)
  })

  it('should handle setVertexAIServiceAccount', () => {
    const serviceAccount = { privateKey: 'test-key', clientEmail: 'test@test.com' }
    const state = llmSlice.reducer(
      initialState,
      llmSlice.actions.setVertexAIServiceAccount(serviceAccount)
    )
    expect(state.settings.vertexai.serviceAccount).toEqual(serviceAccount)
  })

  it('should handle setVertexAIProjectId', () => {
    const state = llmSlice.reducer(initialState, llmSlice.actions.setVertexAIProjectId('test-project'))
    expect(state.settings.vertexai.projectId).toBe('test-project')
  })

  it('should handle setVertexAILocation', () => {
    const state = llmSlice.reducer(initialState, llmSlice.actions.setVertexAILocation('us-central1'))
    expect(state.settings.vertexai.location).toBe('us-central1')
  })
})
