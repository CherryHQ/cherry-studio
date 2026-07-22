import type { ToolLauncherApi } from '@renderer/components/composer/tools/types'
import { toast } from '@renderer/services/toast'
import type { Assistant } from '@renderer/types/assistant'
import type { ThinkingOption } from '@renderer/types/reasoning'
import type { Model, RuntimeReasoning } from '@shared/data/types/model'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ThinkingToolRuntime } from '../ThinkingButton'

const mocks = vi.hoisted(() => ({
  isGPT5SeriesReasoningModel: vi.fn(),
  isOpenAIWebSearchModel: vi.fn(),
  isReasoningModel: vi.fn(),
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
        'assistants.settings.reasoning_effort.max': 'Max',
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

vi.mock('@renderer/utils/model', () => ({
  isGPT5SeriesReasoningModel: (...args: unknown[]) => mocks.isGPT5SeriesReasoningModel(...args),
  isOpenAIWebSearchModel: (...args: unknown[]) => mocks.isOpenAIWebSearchModel(...args),
  isReasoningModel: (...args: unknown[]) => mocks.isReasoningModel(...args)
}))

vi.mock('@renderer/components/icons/SvgIcon', () => ({
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
  enableGenerateImage: false,
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

/** GPT-5-style effort control — the vocabulary the button derives options from. */
const GPT5_REASONING: RuntimeReasoning = {
  controls: [{ kind: 'effort', values: ['minimal', 'low', 'medium', 'high'] }],
  selectableEfforts: ['minimal', 'low', 'medium', 'high']
}

const createModel = (overrides: Record<string, unknown> = {}): Model =>
  ({
    capabilities: ['reasoning'],
    group: 'openai',
    id: 'openai::gpt-5',
    name: 'GPT-5',
    providerId: 'openai',
    reasoning: GPT5_REASONING,
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
    isGPT5SeriesReasoningModel?: boolean
    isOpenAIWebSearchModel?: boolean
    isReasoningModel?: boolean
    launcher?: ToolLauncherApi
    model?: Model
  } = {}
) => {
  const {
    assistant = createAssistant(),
    isGPT5SeriesReasoningModel = false,
    isOpenAIWebSearchModel = false,
    isReasoningModel = true,
    launcher = createLauncherApi(),
    model = createModel()
  } = options
  const updateAssistantSettings = vi.fn()

  mocks.useAssistant.mockReturnValue({ assistant, updateAssistantSettings })
  mocks.isGPT5SeriesReasoningModel.mockReturnValue(isGPT5SeriesReasoningModel)
  mocks.isOpenAIWebSearchModel.mockReturnValue(isOpenAIWebSearchModel)
  mocks.isReasoningModel.mockReturnValue(isReasoningModel)

  render(<ThinkingToolRuntime launcher={launcher} model={model} assistantId={assistant.id} />)

  return { launcher, updateAssistantSettings }
}

describe('ThinkingToolRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      suffix: 'Low'
    })
    expect(thinkingLauncher.submenu?.map((item) => item.id)).toEqual([
      'thinking-default',
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

  it('renders the toggle+budget vocabulary projected by registry enrichment', async () => {
    const { launcher } = renderRuntime({
      model: createModel({
        id: 'anthropic::claude-sonnet-4-5',
        reasoning: {
          controls: [{ kind: 'budget', min: 1024, max: 64_000 }, { kind: 'toggle' }],
          selectableEfforts: ['none', 'low', 'medium', 'high'],
          thinkingTokenLimits: { min: 1024, max: 64_000 }
        } satisfies RuntimeReasoning
      })
    })

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())
    const [thinkingLauncher] = vi.mocked(launcher.registerLaunchers).mock.calls[0][0]
    expect(thinkingLauncher.submenu?.map((item) => item.id)).toEqual([
      'thinking-default',
      'thinking-none',
      'thinking-low',
      'thinking-medium',
      'thinking-high'
    ])
  })

  it("renders the projected native effort vocabulary verbatim (claude 4.6 'max')", async () => {
    const { launcher } = renderRuntime({
      model: createModel({
        id: 'anthropic::claude-opus-4-6',
        reasoning: {
          controls: [{ kind: 'effort', values: ['low', 'medium', 'high', 'max'] }, { kind: 'toggle' }],
          selectableEfforts: ['low', 'medium', 'high', 'max', 'none']
        } satisfies RuntimeReasoning
      })
    })

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())
    const [thinkingLauncher] = vi.mocked(launcher.registerLaunchers).mock.calls[0][0]
    expect(thinkingLauncher.submenu?.map((item) => item.id)).toEqual([
      'thinking-default',
      'thinking-none',
      'thinking-low',
      'thinking-medium',
      'thinking-high',
      'thinking-max'
    ])
    expect(thinkingLauncher.submenu?.find((item) => item.id === 'thinking-max')).toMatchObject({ label: 'Max' })
  })

  it('blocks unsupported and fixed reasoning models in launcher state', async () => {
    const unsupported = renderRuntime({
      isReasoningModel: false,
      model: createModel({ capabilities: [], reasoning: undefined })
    })
    await waitFor(() => expect(unsupported.launcher.registerLaunchers).toHaveBeenCalled())

    const [unsupportedLauncher] = vi.mocked(unsupported.launcher.registerLaunchers).mock.calls[0][0]
    expect(unsupportedLauncher).toMatchObject({
      disabled: true,
      disabledReason: 'Unsupported reasoning model'
    })

    vi.clearAllMocks()

    // Fixed reasoning: reasons (capability) but ships no descriptor knobs.
    const fixed = renderRuntime({ model: createModel({ reasoning: undefined }) })
    await waitFor(() => expect(fixed.launcher.registerLaunchers).toHaveBeenCalled())

    const [fixedLauncher] = vi.mocked(fixed.launcher.registerLaunchers).mock.calls[0][0]
    expect(fixedLauncher).toMatchObject({
      active: false,
      disabled: true,
      disabledReason: 'Fixed reasoning model'
    })
  })

  it('disables the control when registry enrichment projects no options', async () => {
    const { launcher } = renderRuntime({
      model: createModel({
        reasoning: {
          controls: [{ kind: 'budget', min: 1024, max: 32000 }, { kind: 'toggle' }],
          selectableEfforts: [],
          thinkingTokenLimits: { min: 1024, max: 32000 }
        }
      })
    })
    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())

    const [noneLauncher] = vi.mocked(launcher.registerLaunchers).mock.calls[0][0]
    expect(noneLauncher).toMatchObject({ disabled: true, disabledReason: 'Fixed reasoning model' })
  })

  it('offers default and OFF when OFF is the only projected override', async () => {
    const { launcher } = renderRuntime({
      model: createModel({
        reasoning: {
          controls: [{ kind: 'effort', values: ['low', 'medium', 'high'] }],
          selectableEfforts: ['none']
        }
      })
    })
    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())

    const [offOnlyLauncher] = vi.mocked(launcher.registerLaunchers).mock.calls[0][0]
    expect(offOnlyLauncher.disabled).toBeFalsy()
    expect(offOnlyLauncher.submenu?.map((item) => item.id)).toEqual(['thinking-default', 'thinking-none'])
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

    expect(toast.warning).toHaveBeenCalledWith('Cannot use minimal reasoning with web search')
    expect(updateAssistantSettings).not.toHaveBeenCalled()
  })
})
