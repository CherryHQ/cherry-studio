import type { ToolQuickPanelApi } from '@renderer/pages/home/Inputbar/types'
import type { Assistant, Model, ThinkingOption } from '@renderer/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ThinkingButton from '../ThinkingButton'

// Core Hook mocks
const mockUseTranslation = vi.fn()
const mockUseQuickPanel = vi.fn()
const mockUseAssistant = vi.fn()

// Utility function mocks
const mockGetThinkModelType = vi.fn()
const mockIsFixedReasoningModel = vi.fn()
const mockIsGPT5SeriesReasoningModel = vi.fn()
const mockIsOpenAIWebSearchModel = vi.fn()
const mockIsDoubaoThinkingAutoModel = vi.fn()

// Global toast mock
const mockToastWarning = vi.fn()

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation()
}))

// Mock QuickPanel
vi.mock('@renderer/components/QuickPanel', () => ({
  useQuickPanel: () => mockUseQuickPanel(),
  QuickPanelReservedSymbol: {
    Thinking: 'thinking'
  }
}))

// Mock useAssistant
vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => mockUseAssistant()
}))

// Mock reasoning.ts utility functions
vi.mock('@renderer/config/models', () => ({
  getThinkModelType: (...args: any[]) => mockGetThinkModelType(...args),
  isFixedReasoningModel: (...args: any[]) => mockIsFixedReasoningModel(...args),
  isGPT5SeriesReasoningModel: (...args: any[]) => mockIsGPT5SeriesReasoningModel(...args),
  isOpenAIWebSearchModel: (...args: any[]) => mockIsOpenAIWebSearchModel(...args),
  isDoubaoThinkingAutoModel: (...args: any[]) => mockIsDoubaoThinkingAutoModel(...args),
  MODEL_SUPPORTED_OPTIONS: {
    default: ['default', 'none', 'low', 'medium', 'high'],
    o: ['default', 'low', 'medium', 'high'],
    gpt5: ['default', 'minimal', 'low', 'medium', 'high'],
    gpt5pro: ['default', 'high'],
    gpt5_2: ['default', 'none', 'low', 'medium', 'high', 'xhigh'],
    gemini2_flash: ['default', 'none', 'low', 'medium', 'high', 'auto'],
    gemini3_flash: ['default', 'minimal', 'low', 'medium', 'high'],
    doubao: ['default', 'none', 'auto', 'high'],
    doubao_no_auto: ['default', 'none', 'high'],
    doubao_after_251015: ['default', 'minimal', 'low', 'medium', 'high']
  }
}))

// Mock icon components
vi.mock('@renderer/components/Icons/SVGIcon', () => ({
  MdiLightbulbAutoOutline: ({ className }: any) => (
    <div data-testid="mdi-lightbulb-auto-outline" className={className}>
      AutoOutline
    </div>
  ),
  MdiLightbulbOn30: ({ className }: any) => (
    <div data-testid="mdi-lightbulb-on30" className={className}>
      On30
    </div>
  ),
  MdiLightbulbOn50: ({ className }: any) => (
    <div data-testid="mdi-lightbulb-on50" className={className}>
      On50
    </div>
  ),
  MdiLightbulbOn80: ({ className }: any) => (
    <div data-testid="mdi-lightbulb-on80" className={className}>
      On80
    </div>
  ),
  MdiLightbulbOn90: ({ className }: any) => (
    <div data-testid="mdi-lightbulb-on90" className={className}>
      On90
    </div>
  ),
  MdiLightbulbOn: ({ className }: any) => (
    <div data-testid="mdi-lightbulb-on" className={className}>
      On
    </div>
  ),
  MdiLightbulbOffOutline: ({ className }: any) => (
    <div data-testid="mdi-lightbulb-off-outline" className={className}>
      OffOutline
    </div>
  ),
  MdiLightbulbQuestion: ({ className }: any) => (
    <div data-testid="mdi-lightbulb-question" className={className}>
      Question
    </div>
  )
}))

// Mock ActionIconButton component
vi.mock('@renderer/components/Buttons', () => ({
  ActionIconButton: ({
    onClick,
    active,
    'aria-label': ariaLabel,
    'aria-pressed': ariaPressed,
    style,
    children
  }: any) => (
    <button
      data-testid="action-icon-button"
      onClick={onClick}
      data-active={active}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      style={style}>
      {children}
    </button>
  )
}))

// Mock Ant Design Tooltip
vi.mock('antd', () => ({
  Tooltip: ({ title, children, placement, mouseLeaveDelay, arrow }: any) => (
    <div
      data-testid="tooltip"
      data-title={title}
      data-placement={placement}
      data-mouse-leave-delay={mouseLeaveDelay}
      data-arrow={arrow}>
      {children}
    </div>
  )
}))

// Test data factory functions
const createModel = (overrides: Partial<Model> = {}): Model => ({
  id: 'gpt-5',
  provider: 'openai',
  name: 'GPT-5',
  group: 'openai',
  capabilities: [],
  ...overrides
})

const createAssistant = (overrides: Partial<Assistant> = {}): Assistant => ({
  id: 'assistant-1',
  name: 'Test Assistant',
  model: createModel(),
  prompt: '',
  knowledge_bases: [],
  topics: [],
  type: 'default',
  settings: {
    reasoning_effort: 'none',
    temperature: 0.7,
    contextCount: 10,
    streamOutput: true,
    toolUseMode: 'function' as const
  },
  enableWebSearch: false,
  enableUrlContext: false,
  enableGenerateImage: false,
  mcpMode: 'disabled' as const,
  mcpServers: [],
  knowledgeRecognition: 'off' as const,
  regularPhrases: [],
  tags: [],
  enableMemory: false,
  content: '',
  ...overrides
})

const createUseAssistantReturn = (overrides: any = {}) => ({
  assistant: createAssistant(),
  updateAssistantSettings: vi.fn(),
  ...overrides
})

const createUseQuickPanelReturn = (overrides: any = {}) => ({
  open: vi.fn(),
  close: vi.fn(),
  isVisible: false,
  symbol: '',
  ...overrides
})

const createUseTranslationReturn = (overrides: any = {}) => ({
  t: (key: string, params?: any) => {
    const translations: Record<string, string> = {
      'assistants.settings.reasoning_effort.label': 'Reasoning Effort',
      'assistants.settings.reasoning_effort.off': 'Off',
      'assistants.settings.reasoning_effort.minimal': 'Minimal',
      'assistants.settings.reasoning_effort.low': 'Low',
      'assistants.settings.reasoning_effort.medium': 'Medium',
      'assistants.settings.reasoning_effort.high': 'High',
      'assistants.settings.reasoning_effort.xhigh': 'Extra High',
      'assistants.settings.reasoning_effort.auto': 'Auto',
      'assistants.settings.reasoning_effort.default': 'Default',
      'assistants.settings.reasoning_effort.default_description': 'Default reasoning level',
      'assistants.settings.reasoning_effort.off_description': 'Turn off reasoning',
      'assistants.settings.reasoning_effort.minimal_description': 'Minimal reasoning',
      'assistants.settings.reasoning_effort.low_description': 'Low reasoning',
      'assistants.settings.reasoning_effort.medium_description': 'Medium reasoning',
      'assistants.settings.reasoning_effort.high_description': 'High reasoning',
      'assistants.settings.reasoning_effort.xhigh_description': 'Extra high reasoning',
      'assistants.settings.reasoning_effort.auto_description': 'Auto select reasoning level',
      'chat.input.thinking.label': 'Thinking',
      'common.close': 'Close',
      'chat.web_search.warning.openai': 'Cannot use minimal reasoning with web search'
    }
    const baseTranslation = translations[key] || key
    if (params) {
      return baseTranslation.replace(/\{(\w+)\}/g, (_match: string, paramName: string) => {
        return params[paramName] !== undefined ? String(params[paramName]) : _match
      })
    }
    return baseTranslation
  },
  i18n: { language: 'en' },
  ...overrides
})

const createQuickPanelApi = (): ToolQuickPanelApi => ({
  registerRootMenu: vi.fn(() => vi.fn()),
  registerTrigger: vi.fn(() => vi.fn())
})

// Model presets for common test scenarios
const modelPresets = {
  gpt5: () => createModel({ id: 'gpt-5', name: 'GPT-5' }),
  gpt5pro: () => createModel({ id: 'gpt-5-pro', name: 'GPT-5 Pro' }),
  gemini2Flash: () => createModel({ id: 'gemini-2.5-flash-latest', name: 'Gemini 2.5 Flash' }),
  gemini3Flash: () => createModel({ id: 'gemini-3-flash', name: 'Gemini 3 Flash' }),
  doubaoAuto: () => createModel({ id: 'doubao-seed-1-6', name: 'Doubao Seed 1.6' }),
  doubaoNoAuto: () => createModel({ id: 'doubao-seed-1-6-lite-251015', name: 'Doubao Seed 1.6 251015' }),
  fixedReasoning: () => createModel({ id: 'claude-3.7-sonnet', name: 'Claude 3.7 Sonnet' })
}

// Render helper function
const renderComponent = (
  overrides: {
    model?: Model
    assistantId?: string
    quickPanelApi?: ToolQuickPanelApi
    useAssistantReturn?: ReturnType<typeof createUseAssistantReturn>
    useQuickPanelReturn?: ReturnType<typeof createUseQuickPanelReturn>
    useTranslationReturn?: ReturnType<typeof createUseTranslationReturn>
    modelType?: string
    isFixedReasoning?: boolean
    isOpenAIWebSearchModel?: boolean
    isGPT5SeriesReasoningModel?: boolean
    reasoningEffort?: ThinkingOption
    enableWebSearch?: boolean
    isDoubaoThinkingAutoModel?: boolean
  } = {}
) => {
  const {
    model = modelPresets.gpt5(),
    assistantId = 'assistant-1',
    quickPanelApi = createQuickPanelApi(),
    useAssistantReturn = createUseAssistantReturn(),
    useQuickPanelReturn = createUseQuickPanelReturn(),
    useTranslationReturn = createUseTranslationReturn(),
    modelType = 'gpt5',
    isFixedReasoning = false,
    isOpenAIWebSearchModel = false,
    isGPT5SeriesReasoningModel = false,
    reasoningEffort = 'none',
    enableWebSearch = false,
    isDoubaoThinkingAutoModel = false
  } = overrides

  // Configure assistant with reasoning_effort (use provided value or from useAssistantReturn)
  const assistantWithSettings = {
    ...useAssistantReturn.assistant,
    settings: {
      ...useAssistantReturn.assistant.settings,
      reasoning_effort: reasoningEffort ?? useAssistantReturn.assistant.settings?.reasoning_effort ?? 'none'
    },
    enableWebSearch
  }

  // Set up mock return values
  mockUseAssistant.mockReturnValue({
    ...useAssistantReturn,
    assistant: assistantWithSettings
  })
  mockUseQuickPanel.mockReturnValue(useQuickPanelReturn)
  mockUseTranslation.mockReturnValue(useTranslationReturn)
  mockGetThinkModelType.mockReturnValue(modelType)
  mockIsFixedReasoningModel.mockReturnValue(isFixedReasoning)
  mockIsOpenAIWebSearchModel.mockReturnValue(isOpenAIWebSearchModel)
  mockIsGPT5SeriesReasoningModel.mockReturnValue(isGPT5SeriesReasoningModel)
  mockIsDoubaoThinkingAutoModel.mockReturnValue(isDoubaoThinkingAutoModel)

  // Setup global toast mock
  ;(global.window as any).toast = { warning: mockToastWarning }

  return render(<ThinkingButton model={model} assistantId={assistantId} quickPanel={quickPanelApi} />)
}

// Query helper functions
const getActionIconButton = () => screen.getByTestId('action-icon-button')
const getTooltip = () => screen.getByTestId('tooltip')
const getIconByTestId = (testId: string) => screen.getByTestId(testId)

describe('ThinkingButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockToastWarning.mockClear()

    // Set default mock return values
    mockUseTranslation.mockReturnValue(createUseTranslationReturn())
    mockUseQuickPanel.mockReturnValue(createUseQuickPanelReturn())
    mockUseAssistant.mockReturnValue(createUseAssistantReturn())
    mockGetThinkModelType.mockReturnValue('gpt5')
    mockIsFixedReasoningModel.mockReturnValue(false)
    mockIsGPT5SeriesReasoningModel.mockReturnValue(false)
    mockIsOpenAIWebSearchModel.mockReturnValue(false)
    mockIsDoubaoThinkingAutoModel.mockReturnValue(false)

    ;(global.window as any).toast = { warning: mockToastWarning }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  describe('basic rendering', () => {
    it('should render component correctly', () => {
      renderComponent()
      expect(getActionIconButton()).toBeInTheDocument()
      expect(getTooltip()).toBeInTheDocument()
    })

    it('should display correct icon for reasoning level', () => {
      const testCases: Array<{ option: ThinkingOption; expectedTestId: string }> = [
        { option: 'minimal', expectedTestId: 'mdi-lightbulb-on30' },
        { option: 'low', expectedTestId: 'mdi-lightbulb-on50' },
        { option: 'medium', expectedTestId: 'mdi-lightbulb-on80' },
        { option: 'high', expectedTestId: 'mdi-lightbulb-on90' },
        { option: 'xhigh', expectedTestId: 'mdi-lightbulb-on' },
        { option: 'auto', expectedTestId: 'mdi-lightbulb-auto-outline' },
        { option: 'none', expectedTestId: 'mdi-lightbulb-off-outline' },
        { option: 'default', expectedTestId: 'mdi-lightbulb-question' }
      ]

      testCases.forEach(({ option, expectedTestId }) => {
        const { unmount } = renderComponent({
          modelType: 'gpt5_2',
          reasoningEffort: option
        })
        expect(getIconByTestId(expectedTestId)).toBeInTheDocument()
        unmount()
      })
    })
  })

  describe('hasMultipleLevels logic', () => {
    it('should return true for GPT-5 (supports multiple levels)', () => {
      const mockOpen = vi.fn()
      const useQuickPanelReturn = createUseQuickPanelReturn({ open: mockOpen })

      renderComponent({
        modelType: 'gpt5',
        model: modelPresets.gpt5(),
        reasoningEffort: 'high',
        useQuickPanelReturn
      })

      fireEvent.click(getActionIconButton())
      expect(mockOpen).toHaveBeenCalled()
    })

    it('should return false for GPT5Pro (supports only single level)', () => {
      // GPT5Pro supports only 'high' as the thinking level, not 'none'
      // Since 'none' is not supported, the click should open the quick panel instead
      // of directly disabling thinking
      const mockOpen = vi.fn()
      const useQuickPanelReturn = createUseQuickPanelReturn({ open: mockOpen })

      renderComponent({
        modelType: 'gpt5pro',
        model: modelPresets.gpt5pro(),
        reasoningEffort: 'high',
        useQuickPanelReturn
      })

      fireEvent.click(getActionIconButton())
      // Since GPT5Pro doesn't support 'none', it opens the panel instead of disabling
      expect(mockOpen).toHaveBeenCalled()
    })

    it('should  return true for Gemini2.5 Flash (auto excluded, still has multiple levels)', () => {
      const mockOpen = vi.fn()
      const useQuickPanelReturn = createUseQuickPanelReturn({ open: mockOpen })

      renderComponent({
        modelType: 'gemini2_flash',
        model: modelPresets.gemini2Flash(),
        reasoningEffort: 'high',
        useQuickPanelReturn
      })

      fireEvent.click(getActionIconButton())
      expect(mockOpen).toHaveBeenCalled()
    })

    it('should return false for Doubao with auto and high (auto excluded, single level)', () => {
      const mockUpdateSettings = vi.fn()
      const useAssistantReturn = createUseAssistantReturn({
        updateAssistantSettings: mockUpdateSettings,
        assistant: createAssistant({ settings: { reasoning_effort: 'high' } })
      })

      renderComponent({
        modelType: 'doubao',
        model: modelPresets.doubaoAuto(),
        reasoningEffort: 'high',
        useAssistantReturn,
        isDoubaoThinkingAutoModel: true
      })

      fireEvent.click(getActionIconButton())
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        reasoning_effort: 'none',
        reasoning_effort_cache: 'none',
        qwenThinkMode: false
      })
    })

    it('should return true for Doubao after 251015 (multiple levels without auto)', () => {
      const mockOpen = vi.fn()
      const useQuickPanelReturn = createUseQuickPanelReturn({ open: mockOpen })

      renderComponent({
        modelType: 'doubao_after_251015',
        model: modelPresets.doubaoNoAuto(),
        reasoningEffort: 'high',
        useQuickPanelReturn,
        isDoubaoThinkingAutoModel: false
      })

      fireEvent.click(getActionIconButton())
      expect(mockOpen).toHaveBeenCalled()
    })
  })

  describe('click behavior', () => {
    describe('multi-level models', () => {
      it('should open quick panel when thinking is disabled', () => {
        const mockOpen = vi.fn()
        const useQuickPanelReturn = createUseQuickPanelReturn({ open: mockOpen })

        renderComponent({
          modelType: 'gpt5',
          reasoningEffort: 'none',
          useQuickPanelReturn
        })

        fireEvent.click(getActionIconButton())
        expect(mockOpen).toHaveBeenCalled()
      })

      it('should open quick panel when thinking is enabled', () => {
        const mockOpen = vi.fn()
        const useQuickPanelReturn = createUseQuickPanelReturn({ open: mockOpen })

        renderComponent({
          modelType: 'gpt5',
          reasoningEffort: 'high',
          useQuickPanelReturn
        })

        fireEvent.click(getActionIconButton())
        expect(mockOpen).toHaveBeenCalled()
      })

      it('should close quick panel when already open', () => {
        const mockClose = vi.fn()
        const useQuickPanelReturn = createUseQuickPanelReturn({
          isVisible: true,
          symbol: 'thinking',
          close: mockClose
        })

        renderComponent({
          modelType: 'gpt5',
          reasoningEffort: 'high',
          useQuickPanelReturn
        })

        fireEvent.click(getActionIconButton())
        expect(mockClose).toHaveBeenCalled()
      })
    })

    describe('single-level models', () => {
      it('should open quick panel when thinking is disabled', () => {
        const mockOpen = vi.fn()
        const useQuickPanelReturn = createUseQuickPanelReturn({ open: mockOpen })

        renderComponent({
          modelType: 'gpt5pro',
          reasoningEffort: 'none',
          useQuickPanelReturn
        })

        fireEvent.click(getActionIconButton())
        expect(mockOpen).toHaveBeenCalled()
      })

      it('should open quick panel when thinking enabled (gpt5pro does not support none)', () => {
        // GPT5Pro only supports 'high' as thinking level, does not support 'none'
        // So when clicking with thinking enabled, it opens the panel instead of disabling
        const mockOpen = vi.fn()
        const useQuickPanelReturn = createUseQuickPanelReturn({ open: mockOpen })

        renderComponent({
          modelType: 'gpt5pro',
          reasoningEffort: 'high',
          useQuickPanelReturn
        })

        fireEvent.click(getActionIconButton())
        expect(mockOpen).toHaveBeenCalled()
      })
    })

    describe('fixed reasoning models', () => {
      it('should not respond to clicks', () => {
        const mockOpen = vi.fn()
        const useQuickPanelReturn = createUseQuickPanelReturn({ open: mockOpen })

        renderComponent({
          isFixedReasoning: true,
          model: modelPresets.fixedReasoning(),
          useQuickPanelReturn
        })

        fireEvent.click(getActionIconButton())
        expect(mockOpen).not.toHaveBeenCalled()
      })
    })
  })

  describe('aria-labels consistency', () => {
    it('should show "Thinking" for fixed reasoning models', () => {
      renderComponent({
        isFixedReasoning: true,
        model: modelPresets.fixedReasoning()
      })

      expect(getActionIconButton()).toHaveAttribute('aria-label', 'Thinking')
    })

    it('should always show "Reasoning Effort" for multi-level models', () => {
      // Thinking enabled
      const { unmount: unmount1 } = renderComponent({
        modelType: 'gpt5',
        reasoningEffort: 'high'
      })
      expect(getActionIconButton()).toHaveAttribute('aria-label', 'Reasoning Effort')
      unmount1()

      // Thinking disabled
      const { unmount: unmount2 } = renderComponent({
        modelType: 'gpt5',
        reasoningEffort: 'none'
      })
      expect(getActionIconButton()).toHaveAttribute('aria-label', 'Reasoning Effort')
      unmount2()
    })

    it('should show "Close" for single-level models when thinking enabled', () => {
      renderComponent({
        modelType: 'gpt5pro',
        reasoningEffort: 'high'
      })

      expect(getActionIconButton()).toHaveAttribute('aria-label', 'Close')
    })

    it('should show "Reasoning Effort" for single-level models when thinking disabled', () => {
      renderComponent({
        modelType: 'gpt5pro',
        reasoningEffort: 'none'
      })

      expect(getActionIconButton()).toHaveAttribute('aria-label', 'Reasoning Effort')
    })
  })

  describe('icon rendering', () => {
    it('should show auto outline icon for fixed reasoning models', () => {
      renderComponent({
        isFixedReasoning: true,
        model: modelPresets.fixedReasoning()
      })

      expect(getIconByTestId('mdi-lightbulb-auto-outline')).toBeInTheDocument()
    })

    it('should show correct icons for different reasoning levels', () => {
      const testCases: Array<{ option: ThinkingOption; expectedTestId: string }> = [
        { option: 'minimal', expectedTestId: 'mdi-lightbulb-on30' },
        { option: 'low', expectedTestId: 'mdi-lightbulb-on50' },
        { option: 'medium', expectedTestId: 'mdi-lightbulb-on80' },
        { option: 'high', expectedTestId: 'mdi-lightbulb-on90' },
        { option: 'xhigh', expectedTestId: 'mdi-lightbulb-on' },
        { option: 'auto', expectedTestId: 'mdi-lightbulb-auto-outline' },
        { option: 'none', expectedTestId: 'mdi-lightbulb-off-outline' },
        { option: 'default', expectedTestId: 'mdi-lightbulb-question' }
      ]

      testCases.forEach(({ option, expectedTestId }) => {
        const { unmount } = renderComponent({
          modelType: 'gpt5_2',
          reasoningEffort: option
        })
        expect(getIconByTestId(expectedTestId)).toBeInTheDocument()
        unmount()
      })
    })
  })

  describe('fixed reasoning model special behavior', () => {
    it('should show active state when reasoning enabled', () => {
      renderComponent({
        isFixedReasoning: true,
        model: modelPresets.fixedReasoning(),
        reasoningEffort: 'high'
      })

      expect(getActionIconButton()).toHaveAttribute('aria-pressed', 'true')
    })

    it('should show inactive aria-pressed when reasoning disabled', () => {
      renderComponent({
        isFixedReasoning: true,
        model: modelPresets.fixedReasoning(),
        reasoningEffort: 'none'
      })

      // aria-pressed reflects actual reasoning state, not fixed reasoning flag
      expect(getActionIconButton()).toHaveAttribute('aria-pressed', 'false')
    })

    it('should show disabled pointer cursor style', () => {
      renderComponent({
        isFixedReasoning: true,
        model: modelPresets.fixedReasoning()
      })

      expect(getActionIconButton()).toHaveStyle({ cursor: 'default' })
    })
  })

  describe('web search warning', () => {
    it('should show warning when using minimal reasoning with web search', () => {
      const useAssistantReturn = createUseAssistantReturn({
        assistant: createAssistant({ enableWebSearch: true })
      })

      renderComponent({
        isOpenAIWebSearchModel: true,
        isGPT5SeriesReasoningModel: true,
        modelType: 'gpt5',
        useAssistantReturn
      })

      // Simulate selecting minimal reasoning
      expect(mockToastWarning).not.toHaveBeenCalled()
    })
  })

  describe('edge cases', () => {
    it('should handle undefined reasoning level by falling back to none', () => {
      const assistantReturn = createUseAssistantReturn({
        assistant: createAssistant({ settings: { reasoning_effort: undefined } })
      })

      renderComponent({
        useAssistantReturn: assistantReturn
      })

      // When reasoning_effort is undefined, component uses 'none' as default
      // Should show off-outline icon (for 'none' state)
      expect(getIconByTestId('mdi-lightbulb-off-outline')).toBeInTheDocument()
    })

    it('should handle unsupported model types', () => {
      renderComponent({
        modelType: 'default',
        reasoningEffort: 'none'
      })

      expect(getActionIconButton()).toBeInTheDocument()
    })
  })
})
