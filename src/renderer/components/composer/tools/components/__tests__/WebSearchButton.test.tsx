import '@testing-library/jest-dom/vitest'

import type { ToolLauncherApi } from '@renderer/components/composer/tools/types'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import WebSearchButton from '../WebSearchButton'

const mocks = vi.hoisted(() => ({
  updateAssistant: vi.fn(),
  navigate: vi.fn(),
  assistant: undefined as any,
  model: undefined as Model | undefined,
  provider: undefined as any,
  providerLookupId: undefined as string | undefined
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

vi.mock('@renderer/components/ActionIconButton', () => ({
  default: ({
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
  Tooltip: ({ children, content }: React.HTMLAttributes<HTMLDivElement> & { content?: React.ReactNode }) => (
    <div data-testid="tooltip" data-content={String(content)}>
      {children}
    </div>
  )
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({
    assistant: mocks.assistant,
    model: mocks.model,
    updateAssistant: mocks.updateAssistant
  })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviderById: (providerId?: string) => {
    mocks.providerLookupId = providerId
    return { provider: mocks.provider }
  }
}))

vi.mock('@renderer/utils/api', () => ({
  splitApiKeyString: (value: string) => value.split(',').map((item) => item.trim())
}))

vi.mock('@renderer/utils/model', () => {
  const isFunctionCallingModel = (model?: Model) =>
    model?.capabilities.includes(MODEL_CAPABILITY.FUNCTION_CALL) ?? false
  const isServerToolModelEligible = (model?: Model) => model?.apiModelId?.startsWith('claude-') ?? false
  // Mirror the real reconcile composition, including provider-wide search.
  const hasModelBuiltinWebSearch = (
    model?: Model,
    provider?: { serverTools?: Array<{ id: string; modelScope: string }> }
  ) => {
    const tool = provider?.serverTools?.find(({ id }) => id === 'web-search')
    return tool?.modelScope === 'all-chat-models' || (!!tool && isServerToolModelEligible(model))
  }
  const canModelUseAssistantWebSearch = (
    model?: Model,
    provider?: { serverTools?: Array<{ id: string; modelScope: string }> }
  ) => hasModelBuiltinWebSearch(model, provider) || isFunctionCallingModel(model)

  return {
    canModelUseAssistantWebSearch,
    hasModelBuiltinWebSearch,
    isFunctionCallingModel,
    isGemini3Model: () => false,
    isGeminiModel: () => false,
    isGPT5SeriesReasoningModel: () => false,
    isOpenAIWebSearchModel: () => false,
    isSupportedReasoningEffortModel: () => false,
    isSupportedThinkingTokenModel: () => false,
    isServerToolModelEligible
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
    MockUseDataApiUtils.resetMocks()
    MockUseDataApiUtils.mockQueryData('/providers/:providerId/api-keys', { keys: [] })
    mocks.assistant = {
      id: 'assistant-1',
      name: 'Assistant',
      settings: {
        enableWebSearch: false,
        // Lives in `settings` — `getEffectiveMcpMode` reads it there, and its
        // fallback is `manual`, which would predict function-tool signals.
        mcpMode: 'disabled'
      },
      mcpServers: []
    }
    mocks.model = {
      id: 'anthropic::claude-3-5-sonnet',
      providerId: 'anthropic',
      apiModelId: 'claude-3-5-sonnet',
      name: 'Claude 3.5 Sonnet',
      capabilities: [MODEL_CAPABILITY.TEXT_GENERATION],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    }
    mocks.provider = undefined
    mocks.providerLookupId = undefined
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.client_tools_preferred', true)
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.provider_overrides', {})
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.default_search_keywords_provider', null)
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.default_fetch_urls_provider', null)
  })

  it('reads only the current model provider', () => {
    const view = render(<WebSearchButton assistantId="assistant-1" launcher={launcherApi} />)

    expect(mocks.providerLookupId).toBe('anthropic')

    mocks.model = undefined
    view.unmount()
    render(<WebSearchButton assistantId="assistant-1" launcher={launcherApi} />)

    expect(mocks.providerLookupId).toBeUndefined()
  })

  it('opens web search settings and restores trigger focus when external providers are missing', () => {
    vi.mocked(popup.confirm).mockResolvedValue(false)
    render(<WebSearchButton assistantId="assistant-1" launcher={launcherApi} />)

    const button = screen.getByRole('button', { name: 'chat.input.web_search.label' })
    fireEvent.click(button)

    expect(popup.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'settings.tool.websearch.search_provider',
        content: 'settings.tool.websearch.search_provider_placeholder'
      })
    )
    const confirmOptions = vi.mocked(popup.confirm).mock.calls[0][0]
    confirmOptions.focusOnClose?.()

    expect(button).toHaveFocus()
    expect(mocks.updateAssistant).not.toHaveBeenCalled()
  })

  it('does not restore trigger focus after confirming the missing-provider navigation', async () => {
    vi.mocked(popup.confirm).mockResolvedValue(true)
    render(<WebSearchButton assistantId="assistant-1" launcher={launcherApi} />)

    const button = screen.getByRole('button', { name: 'chat.input.web_search.label' })
    fireEvent.click(button)

    const confirmOptions = vi.mocked(popup.confirm).mock.calls[0][0]
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: '/settings/websearch' }))
    confirmOptions.focusOnClose?.()

    expect(button).not.toHaveFocus()
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

    expect(toast.warning).not.toHaveBeenCalled()
    expect(mocks.updateAssistant).not.toHaveBeenCalled()
  })

  it('enables web search with an external provider when the model can call tools', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.default_search_keywords_provider', 'exa-mcp')
    mocks.model = {
      ...mocks.model!,
      capabilities: [MODEL_CAPABILITY.TEXT_GENERATION, MODEL_CAPABILITY.FUNCTION_CALL]
    }

    render(<WebSearchButton assistantId="assistant-1" launcher={launcherApi} />)

    fireEvent.click(screen.getByRole('button', { name: 'chat.input.web_search.label' }))

    await waitFor(() => expect(mocks.updateAssistant).toHaveBeenCalledWith({ settings: { enableWebSearch: true } }))
  })

  it('enables Zhipu web search with an enabled model provider API key', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.default_search_keywords_provider', 'zhipu')
    MockUseDataApiUtils.mockQueryData('/providers/:providerId/api-keys', {
      keys: [{ id: 'zhipu-key', key: 'sk-zhipu', isEnabled: true }]
    })
    mocks.model = {
      ...mocks.model!,
      capabilities: [MODEL_CAPABILITY.TEXT_GENERATION, MODEL_CAPABILITY.FUNCTION_CALL]
    }

    render(<WebSearchButton assistantId="assistant-1" launcher={launcherApi} />)

    await user.click(screen.getByRole('button', { name: 'chat.input.web_search.label' }))

    await waitFor(() => expect(mocks.updateAssistant).toHaveBeenCalledWith({ settings: { enableWebSearch: true } }))
    expect(popup.confirm).not.toHaveBeenCalled()
  })

  it('keeps the settings prompt when Zhipu has no enabled model provider API key', async () => {
    const user = userEvent.setup()
    vi.mocked(popup.confirm).mockResolvedValue(false)
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.default_search_keywords_provider', 'zhipu')
    MockUseDataApiUtils.mockQueryData('/providers/:providerId/api-keys', { keys: [] })
    mocks.model = {
      ...mocks.model!,
      capabilities: [MODEL_CAPABILITY.TEXT_GENERATION, MODEL_CAPABILITY.FUNCTION_CALL]
    }

    render(<WebSearchButton assistantId="assistant-1" launcher={launcherApi} />)

    await user.click(screen.getByRole('button', { name: 'chat.input.web_search.label' }))

    expect(popup.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'settings.tool.websearch.search_provider' })
    )
    expect(mocks.updateAssistant).not.toHaveBeenCalled()
  })

  it('disables Zhipu web search while model provider API keys are loading', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.default_search_keywords_provider', 'zhipu')
    MockUseDataApiUtils.mockQueryLoading('/providers/:providerId/api-keys')
    mocks.model = {
      ...mocks.model!,
      capabilities: [MODEL_CAPABILITY.TEXT_GENERATION, MODEL_CAPABILITY.FUNCTION_CALL]
    }

    render(<WebSearchButton assistantId="assistant-1" launcher={launcherApi} />)

    expect(screen.getByRole('button', { name: 'chat.input.web_search.label' })).toBeDisabled()
    await waitFor(() => expect(launcherApi.registerLaunchers).toHaveBeenCalled())
    const [webSearchLauncher] = vi.mocked(launcherApi.registerLaunchers).mock.calls.at(-1)![0]
    expect(webSearchLauncher.disabled).toBe(true)
  })

  // Both routes render the same globe, and the preference that picks between them lives in settings,
  // so the tooltip is the only place the user can see which side will serve the request.
  it('names the serving side in the tooltip', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.default_search_keywords_provider', 'exa-mcp')
    mocks.model = {
      ...mocks.model!,
      capabilities: [MODEL_CAPABILITY.TEXT_GENERATION, MODEL_CAPABILITY.FUNCTION_CALL]
    }

    const { unmount } = render(<WebSearchButton assistantId="assistant-1" launcher={launcherApi} />)
    expect(screen.getByTestId('tooltip')).toHaveAttribute('data-content', 'chat.input.web_search.route.client')
    unmount()

    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.client_tools_preferred', false)
    mocks.provider = { id: 'gemini', serverTools: [{ id: 'web-search', modelScope: 'model-dependent' }] }
    mocks.model = { ...mocks.model, providerId: 'gemini', apiModelId: 'gemini-2.5-pro' } as Model

    render(<WebSearchButton assistantId="assistant-1" launcher={launcherApi} />)
    expect(screen.getByTestId('tooltip')).toHaveAttribute('data-content', 'chat.input.web_search.route.builtin')
  })

  // The pinned toolbar renders the registered launcher, not the button, and falls back to `label`
  // when the launcher carries no tooltip — which is how the globe kept showing the plain label.
  it('carries the serving side on the registered launcher too', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.default_search_keywords_provider', 'exa-mcp')
    mocks.model = {
      ...mocks.model!,
      capabilities: [MODEL_CAPABILITY.TEXT_GENERATION, MODEL_CAPABILITY.FUNCTION_CALL]
    }

    render(<WebSearchButton assistantId="assistant-1" launcher={launcherApi} />)

    await waitFor(() => expect(launcherApi.registerLaunchers).toHaveBeenCalled())
    const [webSearchLauncher] = vi.mocked(launcherApi.registerLaunchers).mock.calls.at(-1)![0]
    expect(webSearchLauncher.tooltip).toBe('chat.input.web_search.route.client')
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

  it('restores composer focus after the missing-provider confirmation closes from the tool menu', async () => {
    vi.mocked(popup.confirm).mockResolvedValue(false)
    const inputAdapter = {
      getText: vi.fn(() => ''),
      insertText: vi.fn(),
      deleteTriggerRange: vi.fn(),
      focus: vi.fn()
    }

    render(<WebSearchButton assistantId="assistant-1" launcher={launcherApi} />)

    await waitFor(() => expect(launcherApi.registerLaunchers).toHaveBeenCalled())
    const [webSearchLauncher] = vi.mocked(launcherApi.registerLaunchers).mock.calls[0][0]

    webSearchLauncher.action?.({
      inputAdapter,
      quickPanel: {} as never,
      source: 'popover'
    })

    const confirmOptions = vi.mocked(popup.confirm).mock.calls[0][0]
    confirmOptions.focusOnClose?.()

    expect(inputAdapter.focus).toHaveBeenCalledTimes(1)
  })
})
