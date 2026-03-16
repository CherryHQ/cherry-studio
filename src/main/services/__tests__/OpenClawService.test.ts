import fs from 'node:fs'

import type { Model, Provider } from '@types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies that OpenClawService imports
vi.mock('@main/constant', () => ({
  isMac: true,
  isWin: false,
  isLinux: false
}))

vi.mock('@main/utils/ipService', () => ({
  isUserInChina: vi.fn(() => Promise.resolve(false))
}))

vi.mock('@main/utils/process', () => ({
  crossPlatformSpawn: vi.fn(),
  executeCommand: vi.fn(),
  findExecutableInEnv: vi.fn()
}))

vi.mock('@main/utils/shell-env', () => ({
  default: vi.fn(() => Promise.resolve({})),
  refreshShellEnv: vi.fn(() => Promise.resolve({}))
}))

vi.mock('@shared/utils', () => ({
  hasAPIVersion: vi.fn(() => false),
  withoutTrailingSlash: vi.fn((url: string) => url.replace(/\/+$/, ''))
}))

vi.mock('@main/services/WindowService', () => ({
  windowService: {
    getMainWindow: vi.fn(() => null)
  }
}))

vi.mock('@main/services/VertexAIService', () => ({
  default: {
    getInstance: vi.fn()
  }
}))

vi.mock('@shared/IpcChannel', () => ({
  IpcChannel: {
    OpenClaw_InstallProgress: 'openclaw:install-progress'
  }
}))

// Import after mocks
const { openClawService } = await import('@main/services/OpenClawService')

const mockProvider: Provider = {
  id: 'test-provider',
  name: 'Test Provider',
  type: 'openai',
  apiKey: 'sk-test-key',
  apiHost: 'https://api.test.com',
  enabled: true,
  isSystem: false,
  models: [
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'test-provider' } as Model,
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'test-provider' } as Model
  ]
} as Provider

const mockPrimaryModel: Model = {
  id: 'gpt-4o',
  name: 'GPT-4o',
  provider: 'test-provider'
} as Model

const mockVisionModel: Model = {
  id: 'gpt-4o-mini',
  name: 'GPT-4o Mini',
  provider: 'test-provider'
} as Model

const mockEvent = {} as Electron.IpcMainInvokeEvent

describe('OpenClawService.syncProviderConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.writeFileSync).mockImplementation(() => {})
    vi.mocked(fs.mkdirSync).mockImplementation(() => '' as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function getWrittenConfig(): Record<string, any> {
    const call = vi.mocked(fs.writeFileSync).mock.calls[0]
    return JSON.parse(call[1] as string)
  }

  it('sets primary model without imageModel when no vision model provided', async () => {
    const result = await openClawService.syncProviderConfig(mockEvent, mockProvider, mockPrimaryModel)

    expect(result.success).toBe(true)

    const config = getWrittenConfig()
    expect(config.agents.defaults.model).toEqual({
      primary: 'cherry-test-provider/gpt-4o',
      input: ['text', 'image']
    })
    expect(config.agents.defaults.imageModel).toBeUndefined()
  })

  it('sets imageModel at agents.defaults level when vision model provided', async () => {
    const result = await openClawService.syncProviderConfig(mockEvent, mockProvider, mockPrimaryModel, mockVisionModel)

    expect(result.success).toBe(true)

    const config = getWrittenConfig()
    expect(config.agents.defaults.model).toEqual({
      primary: 'cherry-test-provider/gpt-4o',
      input: ['text', 'image']
    })
    expect(config.agents.defaults.imageModel).toEqual({
      primary: 'cherry-test-provider/gpt-4o-mini',
      input: ['text', 'image']
    })
  })

  it('removes existing imageModel when vision model is not provided', async () => {
    // Simulate existing config with imageModel
    const existingConfig = {
      agents: {
        defaults: {
          model: { primary: 'old/model' },
          imageModel: { primary: 'old/vision-model' }
        }
      }
    }
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return String(p).includes('openclaw.cherry.json')
    })
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingConfig))

    const result = await openClawService.syncProviderConfig(mockEvent, mockProvider, mockPrimaryModel)

    expect(result.success).toBe(true)

    const config = getWrittenConfig()
    expect(config.agents.defaults.imageModel).toBeUndefined()
  })

  it('overwrites existing imageModel when new vision model provided', async () => {
    const existingConfig = {
      agents: {
        defaults: {
          model: { primary: 'old/model' },
          imageModel: { primary: 'old/vision-model' }
        }
      }
    }
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return String(p).includes('openclaw.cherry.json')
    })
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingConfig))

    const result = await openClawService.syncProviderConfig(mockEvent, mockProvider, mockPrimaryModel, mockVisionModel)

    expect(result.success).toBe(true)

    const config = getWrittenConfig()
    expect(config.agents.defaults.imageModel).toEqual({
      primary: 'cherry-test-provider/gpt-4o-mini',
      input: ['text', 'image']
    })
  })

  it('writes provider config with correct structure', async () => {
    await openClawService.syncProviderConfig(mockEvent, mockProvider, mockPrimaryModel, mockVisionModel)

    const config = getWrittenConfig()

    // Verify provider config
    const providerConfig = config.models.providers['cherry-test-provider']
    expect(providerConfig).toBeDefined()
    expect(providerConfig.apiKey).toBe('sk-test-key')
    expect(providerConfig.models).toHaveLength(2)

    // Verify gateway config
    expect(config.gateway.mode).toBe('local')
    expect(config.gateway.auth.token).toBeDefined()
  })
})
