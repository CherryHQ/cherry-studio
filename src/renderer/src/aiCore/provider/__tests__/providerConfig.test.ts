import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/services/AssistantService', () => ({
  getProviderByModel: vi.fn()
}))

vi.mock('@renderer/store', () => ({
  default: {
    getState: () => ({ copilot: { defaultHeaders: {} } })
  }
}))

import type { Model, Provider } from '@renderer/types'

import { COPILOT_DEFAULT_HEADERS, COPILOT_EDITOR_VERSION, isCopilotResponsesModel } from '../constants'
import { providerToAiSdkConfig } from '../providerConfig'

const createWindowKeyv = () => {
  const store = new Map<string, string>()
  return {
    get: (key: string) => store.get(key),
    set: (key: string, value: string) => {
      store.set(key, value)
    }
  }
}

const createCopilotProvider = (): Provider => ({
  id: 'copilot',
  type: 'openai',
  name: 'GitHub Copilot',
  apiKey: 'test-key',
  apiHost: 'https://api.githubcopilot.com',
  models: [],
  isSystem: true
})

const createModel = (id: string, name = id): Model => ({
  id,
  name,
  provider: 'copilot',
  group: 'copilot'
})

describe('Copilot responses routing', () => {
  beforeEach(() => {
    ;(globalThis as any).window = {
      ...(globalThis as any).window,
      keyv: createWindowKeyv()
    }
  })

  it('detects official GPT-5 Codex identifiers case-insensitively', () => {
    expect(isCopilotResponsesModel(createModel('gpt-5-codex', 'gpt-5-codex'))).toBe(true)
    expect(isCopilotResponsesModel(createModel('GPT-5-CODEX', 'GPT-5-CODEX'))).toBe(true)
    expect(isCopilotResponsesModel(createModel('gpt-5-codex', 'custom-name'))).toBe(true)
    expect(isCopilotResponsesModel(createModel('custom-id', 'custom-name'))).toBe(false)
  })

  it('configures gpt-5-codex with the Copilot provider', () => {
    const provider = createCopilotProvider()
    const config = providerToAiSdkConfig(provider, createModel('gpt-5-codex', 'GPT-5-CODEX'))

    expect(config.providerId).toBe('github-copilot-openai-compatible')
    expect(config.options.headers?.['Editor-Version']).toBe(COPILOT_EDITOR_VERSION)
    expect(config.options.headers?.['Copilot-Integration-Id']).toBe(
      COPILOT_DEFAULT_HEADERS['Copilot-Integration-Id']
    )
    expect(config.options.headers?.['copilot-vision-request']).toBe('true')
  })

  it('uses the Copilot provider for other models and keeps headers', () => {
    const provider = createCopilotProvider()
    const config = providerToAiSdkConfig(provider, createModel('gpt-4'))

    expect(config.providerId).toBe('github-copilot-openai-compatible')
    expect(config.options.headers?.['Editor-Version']).toBe(COPILOT_DEFAULT_HEADERS['Editor-Version'])
    expect(config.options.headers?.['Copilot-Integration-Id']).toBe(
      COPILOT_DEFAULT_HEADERS['Copilot-Integration-Id']
    )
  })
})
