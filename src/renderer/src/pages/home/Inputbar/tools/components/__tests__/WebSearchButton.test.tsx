import '@testing-library/jest-dom/vitest'

import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import WebSearchButton from '../WebSearchButton'

const updateAssistantMock = vi.fn()
const navigateMock = vi.fn()
const confirmMock = vi.fn()

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()

  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock
}))

vi.mock('@renderer/components/Buttons', () => ({
  ActionIconButton: ({ icon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: React.ReactNode }) => (
    <button type="button" {...props}>
      {icon}
    </button>
  )
}))

vi.mock('antd', () => ({
  Tooltip: ({ children }: React.HTMLAttributes<HTMLDivElement>) => <>{children}</>
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({
    assistant: {
      id: 'assistant-1',
      name: 'Assistant',
      model: {
        id: 'claude-3-5-sonnet',
        provider: 'anthropic',
        name: 'Claude 3.5 Sonnet',
        group: 'anthropic',
        capabilities: []
      },
      settings: {
        toolUseMode: 'function'
      },
      enableWebSearch: false,
      mcpMode: 'disabled',
      mcpServers: []
    },
    updateAssistant: updateAssistantMock
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
    isGemini3Model: () => false,
    isGeminiModel: () => false,
    isGPT5SeriesReasoningModel: () => false,
    isOpenAIWebSearchModel: () => false,
    isWebSearchModel: () => false
  }
})

vi.mock('@renderer/types', () => ({
  BuiltinMCPServerNames: {
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
  },
  getEffectiveMcpMode: () => 'disabled'
}))

vi.mock('@renderer/utils/assistant', () => ({
  isToolUseModeFunction: () => true
}))

vi.mock('@renderer/utils/provider', () => ({
  isGeminiWebSearchProvider: () => false
}))

describe('WebSearchButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.provider_overrides', {})
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.default_search_keywords_provider', null)
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.default_fetch_urls_provider', null)
    Object.assign(window, {
      modal: {
        ...window.modal,
        confirm: confirmMock
      }
    })
  })

  it('opens web search settings and does not update the assistant when external providers are missing', () => {
    render(<WebSearchButton assistantId="assistant-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'chat.input.web_search.label' }))

    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'settings.tool.websearch.search_provider',
        content: 'settings.tool.websearch.search_provider_placeholder'
      })
    )
    expect(updateAssistantMock).not.toHaveBeenCalled()
  })
})
