import type { ToolLauncherApi } from '@renderer/components/chat/composer/tools/types'
import type { Assistant, ThinkingOption } from '@renderer/types'
import type { Model } from '@shared/data/types/model'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ThinkingToolRuntime } from '../ThinkingButton'

const mocks = vi.hoisted(() => ({
  getThinkModelType: vi.fn(),
  isDoubaoThinkingAutoModel: vi.fn(),
  isFixedReasoningModel: vi.fn(),
  isGPT5SeriesReasoningModel: vi.fn(),
  isOpenAIWebSearchModel: vi.fn(),
  isReasoningModel: vi.fn(),
  toastWarning: vi.fn(),
  useAssistant: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'assistants.settings.reasoning_effort.auto': 'Auto',
        'assistants.settings.reasoning_effort.high': 'High',
        'assistants.settings.reasoning_effort.label': 'Reasoning Effort',
        'assistants.settings.reasoning_effort.low': 'Low',
        'assistants.settings.reasoning_effort.medium': 'Medium',
        'assistants.settings.reasoning_effort.minimal': 'Minimal',
        'assistants.settings.reasoning_effort.off': 'Off',
        'assistants.settings.reasoning_effort.xhigh': 'Extra High',
        'chat.input.thinking.fixed_model': 'Fixed reasoning model',
        'chat.input.thinking.unsupported_model': 'Unsupported reasoning model',
        'chat.web_search.warning.openai': 'Cannot use minimal reasoning with web search'
      }

      return translations[key] ?? key
    }
  })
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: (...args: unknown[]) => mocks.useAssistant(...args)
}))

vi.mock('@renderer/data/CacheService', () => ({
  cacheService: {
    set: vi.fn()
  }
}))

vi.mock('@renderer/config/models', () => ({
  getThinkModelType: (...args: unknown[]) => mocks.getThinkModelType(...args),
  isDoubaoThinkingAutoModel: (...args: unknown[]) => mocks.isDoubaoThinkingAutoModel(...args),
  isFixedReasoningModel: (...args: unknown[]) => mocks.isFixedReasoningModel(...args),
  isGPT5SeriesReasoningModel: (...args: unknown[]) => mocks.isGPT5SeriesReasoningModel(...args),
  isOpenAIWebSearchModel: (...args: unknown[]) => mocks.isOpenAIWebSearchModel(...args),
  isReasoningModel: (...args: unknown[]) => mocks.isReasoningModel(...args),
  MODEL_SUPPORTED_OPTIONS: {
    default: ['default', 'none', 'low', 'medium', 'high'],
    doubao: ['default', 'none', 'auto', 'high'],
    gpt5: ['default', 'minimal', 'low', 'medium', 'high'],
    gpt5pro: ['default', 'high']
  }
}))

vi.mock('@renderer/components/Icons/SvgIcon', () => ({
  MdiLightbulbAutoOutline: () => <span data-testid="thinking-auto-icon" />,
  MdiLightbulbOffOutline: () => <span data-testid="thinking-off-icon" />,
  MdiLightbulbOn: () => <span data-testid="thinking-on-icon" />,
  MdiLightbulbOn30: () => <span data-testid="thinking-minimal-icon" />,
  MdiLightbulbOn50: () => <span data-testid="thinking-low-icon" />,
  MdiLightbulbOn80: () => <span data-testid="thinking-medium-icon" />,
  MdiLightbulbOn90: () => <span data-testid="thinking-high-icon" />,
  MdiLightbulbQuestion: () => <span data-testid="thinking-question-icon" />
}))

const DEFAULT_TEST_SETTINGS = {
  customParameters: [],
  enableMaxToolCalls: true,
  enableMaxTokens: false,
  enableTemperature: false,
  enableTopP: false,
  enableWebSearch: false,
  maxTokens: 4096,
  maxToolCalls: 20,
  mcpMode: 'disabled' as const,
  reasoning_effort: 'none' as ThinkingOption,
  streamOutput: true,
  temperature: 0.7,
  topP: 1
}

const createModel = (overrides: Record<string, unknown> = {}): Model =>
  ({
    capabilities: [],
    group: 'openai',
    id: 'openai::gpt-5',
    name: 'GPT-5',
    providerId: 'openai',
    ...overrides
  }) as unknown as Model

const createAssistant = (settings: Partial<Assistant['settings']> = {}): Assistant => ({
  createdAt: new Date().toISOString(),
  description: '',
  emoji: '',
  id: 'assistant-1',
  knowledgeBaseIds: [],
  mcpServerIds: [],
  modelId: null,
  modelName: null,
  name: 'Assistant',
  orderKey: 'a0',
  prompt: '',
  settings: { ...DEFAULT_TEST_SETTINGS, ...settings },
  tags: [],
  updatedAt: new Date().toISOString()
})

const createLauncherApi = (): ToolLauncherApi => ({
  registerLaunchers: vi.fn(() => vi.fn())
})

const renderRuntime = (
  options: {
    assistant?: Assistant
    isFixedReasoning?: boolean
    isGPT5SeriesReasoningModel?: boolean
    isOpenAIWebSearchModel?: boolean
    isReasoningModel?: boolean
    launcher?: ToolLauncherApi
    model?: Model
    modelType?: string
  } = {}
) => {
  const {
    assistant = createAssistant(),
    isFixedReasoning = false,
    isGPT5SeriesReasoningModel = false,
    isOpenAIWebSearchModel = false,
    isReasoningModel = true,
    launcher = createLauncherApi(),
    model = createModel(),
    modelType = 'gpt5'
  } = options
  const updateAssistantSettings = vi.fn()

  mocks.useAssistant.mockReturnValue({ assistant, updateAssistantSettings })
  mocks.getThinkModelType.mockReturnValue(modelType)
  mocks.isDoubaoThinkingAutoModel.mockReturnValue(false)
  mocks.isFixedReasoningModel.mockReturnValue(isFixedReasoning)
  mocks.isGPT5SeriesReasoningModel.mockReturnValue(isGPT5SeriesReasoningModel)
  mocks.isOpenAIWebSearchModel.mockReturnValue(isOpenAIWebSearchModel)
  mocks.isReasoningModel.mockReturnValue(isReasoningModel)

  render(<ThinkingToolRuntime launcher={launcher} model={model} assistantId={assistant.id} />)

  return { launcher, updateAssistantSettings }
}

describe('ThinkingToolRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as any).toast = { warning: mocks.toastWarning }
  })

  it('registers only the runtime launcher for the plus menu', async () => {
    const { launcher } = renderRuntime({
      assistant: createAssistant({ reasoning_effort: 'low' })
    })

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())

    const [thinkingLauncher] = vi.mocked(launcher.registerLaunchers).mock.calls[0][0]

    expect(thinkingLauncher).toMatchObject({
      id: 'thinking',
      kind: 'group',
      sources: ['popover'],
      showInActiveControls: false,
      suffix: 'Low'
    })
    expect(thinkingLauncher.submenu?.map((item) => item.id)).toEqual([
      'thinking-minimal',
      'thinking-low',
      'thinking-medium',
      'thinking-high'
    ])
    expect(thinkingLauncher.submenu?.every((item) => item.sources?.includes('popover'))).toBe(true)
    expect(thinkingLauncher.submenu?.some((item) => item.sources?.includes('root-panel'))).toBe(false)
    expect(thinkingLauncher.submenu?.find((item) => item.id === 'thinking-low')).toMatchObject({ active: true })
  })

  it('cycles GPT-5 from off to the first supported reasoning level', async () => {
    const { launcher, updateAssistantSettings } = renderRuntime({
      assistant: createAssistant({ reasoning_effort: 'none' })
    })

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())

    const [thinkingLauncher] = vi.mocked(launcher.registerLaunchers).mock.calls[0][0]
    thinkingLauncher.action?.({
      quickPanel: {} as any,
      source: 'popover'
    })

    expect(updateAssistantSettings).toHaveBeenCalledWith({
      reasoning_effort: 'minimal'
    })
  })

  it('blocks unsupported and fixed reasoning models in launcher state', async () => {
    const unsupported = renderRuntime({ isReasoningModel: false })
    await waitFor(() => expect(unsupported.launcher.registerLaunchers).toHaveBeenCalled())

    const [unsupportedLauncher] = vi.mocked(unsupported.launcher.registerLaunchers).mock.calls[0][0]
    expect(unsupportedLauncher).toMatchObject({
      disabled: true,
      disabledReason: 'Unsupported reasoning model'
    })

    vi.clearAllMocks()

    const fixed = renderRuntime({ isFixedReasoning: true })
    await waitFor(() => expect(fixed.launcher.registerLaunchers).toHaveBeenCalled())

    const [fixedLauncher] = vi.mocked(fixed.launcher.registerLaunchers).mock.calls[0][0]
    expect(fixedLauncher).toMatchObject({
      active: false,
      disabled: true,
      disabledReason: 'Fixed reasoning model'
    })
  })

  it('keeps OpenAI web search from selecting minimal reasoning', async () => {
    const { launcher, updateAssistantSettings } = renderRuntime({
      assistant: createAssistant({ enableWebSearch: true, reasoning_effort: 'none' }),
      isGPT5SeriesReasoningModel: true,
      isOpenAIWebSearchModel: true
    })

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())

    const [thinkingLauncher] = vi.mocked(launcher.registerLaunchers).mock.calls[0][0]
    thinkingLauncher.submenu
      ?.find((item) => item.id === 'thinking-minimal')
      ?.action?.({
        quickPanel: {} as any,
        source: 'popover'
      })

    expect(mocks.toastWarning).toHaveBeenCalledWith('Cannot use minimal reasoning with web search')
    expect(updateAssistantSettings).not.toHaveBeenCalled()
  })
})
