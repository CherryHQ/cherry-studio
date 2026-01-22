import type { Model, Provider } from '@renderer/types'
import { codeTools } from '@shared/config/constant'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock CodeToolsPage which is the default export
vi.mock('../CodeToolsPage', () => ({ default: () => null }))

// Mock dependencies needed by CodeToolsPage
vi.mock('@renderer/hooks/useCodeTools', () => ({
  useCodeTools: () => ({
    selectedCliTool: codeTools.qwenCode,
    selectedModel: null,
    selectedTerminal: 'systemDefault',
    environmentVariables: '',
    directories: [],
    currentDirectory: '',
    canLaunch: true,
    setCliTool: vi.fn(),
    setModel: vi.fn(),
    setTerminal: vi.fn(),
    setEnvVars: vi.fn(),
    setCurrentDir: vi.fn(),
    removeDir: vi.fn(),
    selectFolder: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: [] }),
  useAllProviders: () => []
}))

vi.mock('@renderer/services/AssistantService', () => ({
  getProviderByModel: vi.fn()
}))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/store', () => ({
  useAppDispatch: () => vi.fn(),
  useAppSelector: () => false
}))

vi.mock('@renderer/aiCore', () => ({
  default: class {
    getBaseURL() {
      return ''
    }
    getApiKey() {
      return ''
    }
  }
}))

vi.mock('@renderer/utils/api', () => ({
  formatApiHost: vi.fn((host) => {
    if (!host) return ''
    const normalized = host.replace(/\/$/, '').trim()
    if (normalized.endsWith('#')) {
      return normalized.replace(/#$/, '')
    }
    if (/\/v\d+(?:alpha|beta)?(?=\/|$)/i.test(normalized)) {
      return normalized
    }
    return `${normalized}/v1`
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('generateToolEnvironment', () => {
  const createMockModel = (id: string, provider: string): Model => ({
    id,
    name: id,
    provider,
    group: provider
  })

  const createMockProvider = (id: string, apiHost: string): Provider => ({
    id,
    type: 'openai',
    name: id,
    apiKey: 'test-key',
    apiHost,
    models: [],
    isSystem: true
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should format baseUrl with /v1 for qwenCode when missing', async () => {
    const { generateToolEnvironment } = await import('../index')
    const model = createMockModel('qwen-turbo', 'dashscope')
    const provider = createMockProvider('dashscope', 'https://dashscope.aliyuncs.com/compatible-mode')

    const { env } = generateToolEnvironment({
      tool: codeTools.qwenCode,
      model,
      modelProvider: provider,
      apiKey: 'test-key',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode'
    })

    expect(env.OPENAI_BASE_URL).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
  })

  it('should not duplicate /v1 when already present for qwenCode', async () => {
    const { generateToolEnvironment } = await import('../index')
    const model = createMockModel('qwen-turbo', 'dashscope')
    const provider = createMockProvider('dashscope', 'https://dashscope.aliyuncs.com/compatible-mode/v1')

    const { env } = generateToolEnvironment({
      tool: codeTools.qwenCode,
      model,
      modelProvider: provider,
      apiKey: 'test-key',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    })

    expect(env.OPENAI_BASE_URL).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
  })

  it('should handle empty baseUrl gracefully', async () => {
    const { generateToolEnvironment } = await import('../index')
    const model = createMockModel('qwen-turbo', 'dashscope')
    const provider = createMockProvider('dashscope', '')

    const { env } = generateToolEnvironment({
      tool: codeTools.qwenCode,
      model,
      modelProvider: provider,
      apiKey: 'test-key',
      baseUrl: ''
    })

    expect(env.OPENAI_BASE_URL).toBe('')
  })

  it('should preserve other API versions when present', async () => {
    const { generateToolEnvironment } = await import('../index')
    const model = createMockModel('qwen-plus', 'dashscope')
    const provider = createMockProvider('dashscope', 'https://dashscope.aliyuncs.com/v2')

    const { env } = generateToolEnvironment({
      tool: codeTools.qwenCode,
      model,
      modelProvider: provider,
      apiKey: 'test-key',
      baseUrl: 'https://dashscope.aliyuncs.com/v2'
    })

    expect(env.OPENAI_BASE_URL).toBe('https://dashscope.aliyuncs.com/v2')
  })

  it('should format baseUrl with /v1 for openaiCodex when missing', async () => {
    const { generateToolEnvironment } = await import('../index')
    const model = createMockModel('gpt-4', 'openai')
    const provider = createMockProvider('openai', 'https://api.openai.com')

    const { env } = generateToolEnvironment({
      tool: codeTools.openaiCodex,
      model,
      modelProvider: provider,
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com'
    })

    expect(env.OPENAI_BASE_URL).toBe('https://api.openai.com/v1')
  })

  it('should format baseUrl with /v1 for iFlowCli when missing', async () => {
    const { generateToolEnvironment } = await import('../index')
    const model = createMockModel('gpt-4', 'iflow')
    const provider = createMockProvider('iflow', 'https://api.iflow.cn')

    const { env } = generateToolEnvironment({
      tool: codeTools.iFlowCli,
      model,
      modelProvider: provider,
      apiKey: 'test-key',
      baseUrl: 'https://api.iflow.cn'
    })

    expect(env.IFLOW_BASE_URL).toBe('https://api.iflow.cn/v1')
  })

  it('should handle trailing slash correctly', async () => {
    const { generateToolEnvironment } = await import('../index')
    const model = createMockModel('qwen-turbo', 'dashscope')
    const provider = createMockProvider('dashscope', 'https://dashscope.aliyuncs.com/compatible-mode/')

    const { env } = generateToolEnvironment({
      tool: codeTools.qwenCode,
      model,
      modelProvider: provider,
      apiKey: 'test-key',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/'
    })

    expect(env.OPENAI_BASE_URL).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
  })

  it('should handle v2beta version correctly', async () => {
    const { generateToolEnvironment } = await import('../index')
    const model = createMockModel('qwen-plus', 'dashscope')
    const provider = createMockProvider('dashscope', 'https://dashscope.aliyuncs.com/v2beta')

    const { env } = generateToolEnvironment({
      tool: codeTools.qwenCode,
      model,
      modelProvider: provider,
      apiKey: 'test-key',
      baseUrl: 'https://dashscope.aliyuncs.com/v2beta'
    })

    expect(env.OPENAI_BASE_URL).toBe('https://dashscope.aliyuncs.com/v2beta')
  })
})
