import { configureStore } from '@reduxjs/toolkit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { replacePromptVariables } from '../prompt'

// Mock window.api
const mockApi = {
  system: {
    getDeviceType: vi.fn()
  },
  getAppInfo: vi.fn()
}

vi.mock('@renderer/store', () => {
  const mockStore = configureStore({
    reducer: {
      settings: (
        state = {
          language: 'zh-CN',
          userName: 'MockUser'
        }
      ) => state
    }
  })
  return {
    default: mockStore,
    __esModule: true
  }
})

// `replacePromptVariables` only needs the model name string. The tests used
// to pass through a full Assistant just to read `.model.name`; the v2 model
// lookup happens at the call site, so the helper is a name pair only.
const createMockAssistant = (_name: string, modelName: string) => ({ modelName })

// 设置全局 mocks
Object.defineProperty(window, 'api', {
  value: mockApi,
  writable: true
})

describe('prompt', () => {
  const mockDate = new Date('2024-01-01T12:00:00Z')

  beforeEach(() => {
    // 重置所有 mocks
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(mockDate)

    // 设置默认的 mock 返回值
    mockApi.system.getDeviceType.mockResolvedValue('macOS')
    mockApi.getAppInfo.mockResolvedValue({ arch: 'darwin64' })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('buildSystemPrompt', () => {
    it('should replace all variables correctly with strict equality', async () => {
      const userPrompt = `
以下是一些辅助信息:
  - 日期和时间: {{datetime}};
  - 操作系统: {{system}};
  - 中央处理器架构: {{arch}};
  - 语言: {{language}};
  - 模型名称: {{model_name}};
  - 用户名称: {{username}};
`
      const assistant = createMockAssistant('MyAssistant', 'Super-Model-X')
      const result = await replacePromptVariables(userPrompt, assistant.modelName)
      const expectedPrompt = `
以下是一些辅助信息:
  - 日期和时间: ${mockDate.toLocaleString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric'
  })};
  - 操作系统: macOS;
  - 中央处理器架构: darwin64;
  - 语言: zh-CN;
  - 模型名称: Super-Model-X;
  - 用户名称: MockUser;
`
      expect(result).toEqual(expectedPrompt)
    })

    it('should handle API errors gracefully and use fallback values', async () => {
      mockApi.system.getDeviceType.mockRejectedValue(new Error('API Error'))
      mockApi.getAppInfo.mockRejectedValue(new Error('API Error'))

      const userPrompt = 'System: {{system}}, Architecture: {{arch}}'
      const result = await replacePromptVariables(userPrompt)
      const expectedPrompt = 'System: Unknown System, Architecture: Unknown Architecture'
      expect(result).toEqual(expectedPrompt)
    })

    it('should handle non-string input gracefully', async () => {
      const result = await replacePromptVariables(null as any)
      expect(result).toBe(null)
    })
  })
})
