import '@testing-library/jest-dom/vitest'

import type { ToolLauncherApi } from '@renderer/components/composer/tools/types'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import UrlContextButton, { UrlContextToolRuntime } from '../UrlContextButton'

const mocks = vi.hoisted(() => ({
  updateAssistant: vi.fn(),
  assistant: undefined as any,
  model: undefined as Model | undefined,
  provider: undefined as Partial<Provider> | undefined
}))

const launcherApi: ToolLauncherApi = {
  registerLaunchers: vi.fn(() => vi.fn())
}

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) }
})

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
  Tooltip: ({ children }: React.HTMLAttributes<HTMLDivElement>) => <>{children}</>
}))

vi.mock('@renderer/components/composer/quickPanel', () => ({
  getQuickPanelSearchAliases: () => []
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({
    assistant: mocks.assistant,
    model: mocks.model,
    updateAssistant: mocks.updateAssistant
  })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: () => ({ provider: mocks.provider })
}))

const geminiModel: Model = {
  id: 'gemini::gemini-2.5-pro',
  providerId: 'gemini',
  apiModelId: 'gemini-2.5-pro',
  name: 'Gemini 2.5 Pro',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
}

const openaiModel: Model = {
  ...geminiModel,
  id: 'openai::gpt-5',
  providerId: 'openai',
  apiModelId: 'gpt-5',
  name: 'GPT-5'
}

describe('UrlContextButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.assistant = { id: 'assistant-1', name: 'Assistant', settings: { enableUrlContext: false } }
    mocks.model = geminiModel
    mocks.provider = { id: 'gemini', serverTools: [{ id: 'url-context', modelScope: 'model-dependent' }] }
  })

  it('enables url context when the provider serves it and the model is a Gemini/Anthropic SKU', async () => {
    render(<UrlContextButton assistantId="assistant-1" launcher={launcherApi} />)
    fireEvent.click(screen.getByRole('button', { name: 'chat.input.url_context' }))
    await waitFor(() => expect(mocks.updateAssistant).toHaveBeenCalledWith({ settings: { enableUrlContext: true } }))
  })

  it('disables the toggle when the provider does not serve url context', () => {
    mocks.provider = { id: 'gemini', serverTools: [] }
    render(<UrlContextButton assistantId="assistant-1" launcher={launcherApi} />)
    const button = screen.getByRole('button', { name: 'chat.input.url_context' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(mocks.updateAssistant).not.toHaveBeenCalled()
  })

  it('disables the toggle for a non-Gemini/Anthropic model even on a supporting provider', () => {
    mocks.model = openaiModel
    mocks.provider = { id: 'openai', serverTools: [{ id: 'url-context', modelScope: 'model-dependent' }] }
    render(<UrlContextButton assistantId="assistant-1" launcher={launcherApi} />)
    expect(screen.getByRole('button', { name: 'chat.input.url_context' })).toBeDisabled()
  })

  it('registers a url-context launcher for the plus menu', async () => {
    render(<UrlContextToolRuntime assistantId="assistant-1" launcher={launcherApi} />)
    await waitFor(() => expect(launcherApi.registerLaunchers).toHaveBeenCalled())
    const [launcher] = vi.mocked(launcherApi.registerLaunchers).mock.calls[0][0]
    expect(launcher).toMatchObject({ id: 'url-context', sources: ['popover'] })
  })
})
