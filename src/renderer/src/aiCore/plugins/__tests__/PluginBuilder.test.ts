import type { Assistant, Model, Provider } from '@renderer/types'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/hooks/useSettings', () => ({ getEnableDeveloperMode: () => false }))

const { buildPlugins } = await import('../PluginBuilder')

describe('buildPlugins', () => {
  it('extracts inline reasoning tags from Ollama text responses', () => {
    const provider = {
      id: 'ollama',
      type: 'ollama',
      name: 'Ollama',
      apiKey: '',
      apiHost: 'http://localhost:11434'
    } as Provider
    const model = { id: 'qwen3:8b', name: 'Qwen3 8B', provider: 'ollama', group: 'qwen' } as Model
    const assistant = { id: 'assistant', name: 'Assistant', settings: {} } as Assistant

    const plugins = buildPlugins({
      provider,
      model,
      config: {
        assistant,
        streamOutput: true,
        enableReasoning: true,
        isPromptToolUse: false,
        isSupportedToolUse: false,
        enableWebSearch: false,
        enableGenerateImage: false,
        enableUrlContext: false
      }
    })

    expect(plugins.map((plugin) => plugin.name)).toContain('reasoningExtraction')
  })
})
