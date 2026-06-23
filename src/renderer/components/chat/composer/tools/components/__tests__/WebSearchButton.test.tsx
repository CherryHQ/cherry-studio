import '@testing-library/jest-dom/vitest'

import type { ToolLauncherApi } from '@renderer/components/chat/composer/tools/types'
import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import WebSearchButton from '../WebSearchButton'

const mocks = vi.hoisted(() => ({
  updateAssistant: vi.fn(),
  navigate: vi.fn(),
  confirm: vi.fn(),
  toastWarning: vi.fn(),
  assistant: undefined as any,
  model: undefined as Model | undefined
}))

const launcherApi: ToolLauncherApi = {
  registerLaunchers: vi.fn(() => vi.fn())
}

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()

  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate
}))

vi.mock('@renderer/components/Buttons', () => ({
  ActionIconButton: ({
    icon,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; icon: React.ReactNode }) => {
    const buttonProps = { ...props }
    delete buttonProps.active
    return (
      <button type="button" {...buttonProps}>
        {icon}
      </button>
    )
  }
}))

vi.mock('@cherrystudio/ui', () => ({
  Tooltip: ({ children }: React.HTMLAttributes<HTMLDivElement>) => <>{children}</>
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({
    assistant: mocks.assistant,
    model: mocks.model,
    updateAssistant: mocks.updateAssistant
  })
}))

vi.mock('@renderer/utils/api', () => ({
  splitApiKeyString: (value: string) => value.split(',').map((item) => item.trim())
}))

vi.mock('@renderer/config/models', () => {
  const qwenModel = {
    id: 'qwen',
    name: 'Qwen',
    provider: 'cherryai',
    group: 'Qwen'
  }

  return {
    qwenModel,
    SYSTEM_MODELS: new Proxy(
      { defaultModel: [qwenModel] },
      {
        get: (target, prop) => (prop in target ? target[prop as keyof typeof target] : [])
      }
    ),
    getThinkModelType: () => 'default',
    isFunctionCallingModel: (model?: Model) => model?.capabilities.includes(MODEL_CAPABILITY.FUNCTION_CALL) ?? false,
    isGemini3Model: () => false,
    isGeminiModel: () => false,
    isGPT5SeriesReasoningModel: () => false,
    isOpenRouterBuiltInWebSearchModel: () => false,
    isOpenAIWebSearchModel: () => false,
    isSupportedReasoningEffortModel: () => false,
    isSupportedThinkingTokenModel: () => false,
    isWebSearchModel: (model?: Model) => model?.capabilities.includes(MODEL_CAPABILITY.WEB_SEARCH) ?? false,
    MODEL_SUPPORTED_OPTIONS: { default: ['none'] },
    MODEL_SUPPORTED_REASONING_EFFORT: { default: ['none'] }
  }
})

vi.mock('@renderer/types', () => {
  const builtinMcpServerNames = {
    flomo: '@cherry/flomo',
    mcpAutoInstall: '@cherry/mcp-auto-install',
    memory: '@cherry/memory',
    sequentialThinking: '@cherry/sequentialthinking',
    braveSearch: '@cherry/brave-search',
    fetch: '@cherry/fetch',
    filesystem: '@cherry/filesystem',
    difyKnowledge: '@cherry/dify-knowledge',
    python: '@cherry/python',
    didiMCP: '@cherry/didi-mcp',
    browser: '@cherry/browser',
    nowledgeMem: '@cherry/nowledge-mem',
    hub: '@cherry/hub'
  }

  return {
    BuiltinMCPServerNames: builtinMcpServerNames,
    BuiltinMcpServerNames: builtinMcpServerNames,
    getEffectiveMcpMode: () => 'disabled'
  }
})

describe('WebSearchButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.assistant = {
      id: 'assistant-1',
      name: 'Assistant',
      settings: {
        enableWebSearch: false
      },
      mcpMode: 'disabled',
      mcpServers: []
    }
    mocks.model = {
      id: 'anthropic::claude-3-5-sonnet',
      providerId: 'anthropic',
      apiModelId: 'claude-3-5-sonnet',
      name: 'Claude 3.5 Sonnet',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    }
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.provider_overrides', {})
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.default_search_keywords_provider', null)
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.default_fetch_urls_provider', null)
    Object.assign(window, {
      modal: {
        ...window.modal,
        confirm: mocks.confirm
      },
      toast: {
        ...window.toast,
        warning: mocks.toastWarning
      }
    })
  })

  it('opens web search settings and does not update the assistant when external providers are missing', () => {
    render(<WebSearchButton assistantId="assistant-1" launcher={launcherApi} />)

    fireEvent.click(screen.getByRole('button', { name: 'chat.input.web_search.label' }))

    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'settings.tool.websearch.search_provider',
        content: 'settings.tool.websearch.search_provider_placeholder'
      })
    )
    expect(mocks.updateAssistant).not.toHaveBeenCalled()
  })

  it('disables web search when the configured provider cannot be consumed by the current model', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.default_search_keywords_provider', 'exa-mcp')

    render(<WebSearchButton assistantId="assistant-1" launcher={launcherApi} />)

    const button = screen.getByRole('button', { name: 'chat.input.web_search.label' })
    expect(button).toBeDisabled()

    await waitFor(() => expect(launcherApi.registerLaunchers).toHaveBeenCalled())
    const [webSearchLauncher] = vi.mocked(launcherApi.registerLaunchers).mock.calls[0][0]
    expect(webSearchLauncher).toMatchObject({
      disabled: true,
      disabledReason: 'chat.input.web_search.builtin.disabled_content'
    })

    fireEvent.click(button)

    expect(mocks.toastWarning).not.toHaveBeenCalled()
    expect(mocks.updateAssistant).not.toHaveBeenCalled()
  })

  it('enables web search with an external provider when the model can call tools', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.default_search_keywords_provider', 'exa-mcp')
    mocks.model = {
      ...mocks.model!,
      capabilities: [MODEL_CAPABILITY.FUNCTION_CALL]
    }

    render(<WebSearchButton assistantId="assistant-1" launcher={launcherApi} />)

    fireEvent.click(screen.getByRole('button', { name: 'chat.input.web_search.label' }))

    await waitFor(() => expect(mocks.updateAssistant).toHaveBeenCalledWith({ settings: { enableWebSearch: true } }))
  })

  it('registers web search only for the plus menu', async () => {
    render(<WebSearchButton assistantId="assistant-1" launcher={launcherApi} />)

    await waitFor(() => expect(launcherApi.registerLaunchers).toHaveBeenCalled())

    const [webSearchLauncher] = vi.mocked(launcherApi.registerLaunchers).mock.calls[0][0]
    expect(webSearchLauncher).toMatchObject({
      id: 'web-search',
      sources: ['popover']
    })
  })
})
