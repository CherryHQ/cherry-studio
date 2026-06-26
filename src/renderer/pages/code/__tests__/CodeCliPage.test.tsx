import '@testing-library/jest-dom/vitest'

import type { EndpointType, Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { codeCLI, terminalApps } from '@shared/types/codeCli'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  isBunInstalled: true,
  selectedCliTool: 'github-copilot-cli',
  selectedModel: null as string | null,
  canLaunch: true,
  codeCliRun: vi.fn(),
  setModel: vi.fn(),
  setTimeoutTimer: vi.fn(),
  providers: [] as Provider[],
  models: [] as Model[],
  modelSelectorProps: [] as any[]
}))

import CodeCliPage from '../CodeCliPage'

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')

  return {
    Button: ({ children, loading, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) =>
      React.createElement('button', { type: 'button', ...props, disabled: props.disabled || loading }, children),
    Checkbox: ({
      className,
      id,
      onCheckedChange
    }: {
      className?: string
      id?: string
      onCheckedChange?: (v: boolean) => void
    }) =>
      React.createElement('button', {
        id,
        type: 'button',
        role: 'checkbox',
        className,
        onClick: () => onCheckedChange?.(true)
      }),
    Label: ({ children, htmlFor, className }: { children: React.ReactNode; htmlFor?: string; className?: string }) =>
      React.createElement('label', { htmlFor, className }, children),
    Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
      open ? React.createElement('div', { role: 'dialog' }, children) : null,
    DialogContent: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    DialogHeader: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    DialogTitle: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    DialogFooter: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    DialogClose: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    SelectDropdown: () => React.createElement('div', null),
    Textarea: {
      Input: ({ value, onValueChange }: { value?: string; onValueChange?: (value: string) => void }) =>
        React.createElement('textarea', {
          value,
          onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onValueChange?.(event.currentTarget.value)
        })
    }
  }
})

vi.mock('@renderer/components/app/Navbar', () => ({
  Navbar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  NavbarCenter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: () => null
}))

vi.mock('@renderer/components/Selector/model', async () => {
  const React = await import('react')

  return {
    ModelSelector: (props: any) => {
      testState.modelSelectorProps.push(props)

      return React.createElement(
        'div',
        { 'data-testid': 'code-model-selector' },
        props.trigger,
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: () => props.onSelect('openai::gpt-4o')
          },
          'select mock model'
        )
      )
    }
  }
})

vi.mock('@renderer/config/constant', () => ({
  isMac: false,
  isWin: false
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: vi.fn().mockResolvedValue({ version: '1.0.0' })
  }
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  usePersistCache: () => [testState.isBunInstalled, vi.fn()]
}))

vi.mock('@renderer/hooks/useCodeCli', () => ({
  useCodeCli: () => ({
    selectedCliTool: testState.selectedCliTool as codeCLI,
    selectedModel: testState.selectedModel,
    selectedTerminal: terminalApps.systemDefault,
    environmentVariables: '',
    directories: [],
    currentDirectory: '',
    canLaunch: testState.canLaunch,
    setCliTool: vi.fn().mockResolvedValue(undefined),
    setModel: testState.setModel,
    setTerminal: vi.fn(),
    setEnvVars: vi.fn(),
    setCurrentDir: vi.fn().mockResolvedValue(undefined),
    removeDir: vi.fn().mockResolvedValue(undefined),
    selectFolder: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: testState.providers }),
  getProviderDisplayName: (provider: { name?: string; id?: string }) => provider?.name ?? provider?.id ?? ''
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({ models: testState.models })
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: testState.setTimeoutTimer })
}))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@shared/config/providers', () => ({
  CLAUDE_OFFICIAL_SUPPORTED_PROVIDERS: [],
  isSiliconAnthropicCompatibleModel: () => false
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../components/CodeToolGallery', () => ({
  CodeToolGallery: ({
    tools,
    handleSelectTool
  }: {
    tools: Array<{ value: codeCLI; label: string }>
    handleSelectTool: (value: codeCLI) => void
  }) => (
    <button type="button" onClick={() => handleSelectTool(tools[0].value)}>
      open tool
    </button>
  )
}))

vi.mock('../components/FieldLabel', () => ({
  FieldLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

beforeEach(() => {
  vi.clearAllMocks()
  testState.isBunInstalled = true
  testState.selectedCliTool = codeCLI.githubCopilotCli
  testState.selectedModel = null
  testState.canLaunch = true
  testState.codeCliRun.mockResolvedValue({ success: true })
  testState.setModel.mockResolvedValue(undefined)
  testState.providers = []
  testState.models = []
  testState.modelSelectorProps = []
  Object.assign(window, {
    api: {
      isBinaryExist: vi.fn().mockResolvedValue(true),
      codeCli: {
        getAvailableTerminals: vi.fn().mockResolvedValue([]),
        run: testState.codeCliRun
      }
    },
    toast: {
      error: vi.fn(),
      success: vi.fn(),
      warning: vi.fn()
    }
  })
})

async function openCodeToolDialog() {
  render(<CodeCliPage />)
  await waitFor(() => expect(window.api.isBinaryExist).toHaveBeenCalledWith('bun'))
  fireEvent.click(screen.getByRole('button', { name: 'open tool' }))
  await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
}

function makeProvider(
  id: string,
  defaultChatEndpoint: EndpointType | undefined = ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  overrides: Partial<Provider> = {}
): Provider {
  return {
    id,
    name: id,
    apiKeys: [],
    authType: 'api-key',
    defaultChatEndpoint,
    endpointConfigs: {},
    apiFeatures: {},
    settings: {},
    isEnabled: true,
    ...overrides
  } as Provider
}

function makeModel(id: string, providerId: string, overrides: Partial<Model> = {}): Model {
  return {
    id,
    providerId,
    name: id.split('::')[1] ?? id,
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  } as Model
}

function latestModelSelectorProps() {
  return testState.modelSelectorProps.at(-1)
}

describe('CodeCliPage', () => {
  it('uses the shared model selector for non-copilot tools and writes selected ids back', async () => {
    testState.selectedCliTool = codeCLI.qwenCode

    await openCodeToolDialog()

    expect(screen.getByTestId('code-model-selector')).toBeInTheDocument()
    expect(latestModelSelectorProps()).toMatchObject({
      multiple: false,
      selectionType: 'id',
      showTagFilter: false
    })
    await waitFor(() => expect(latestModelSelectorProps().portalContainer).toBeInstanceOf(HTMLElement))
    expect(latestModelSelectorProps().portalContainer.closest('[role="dialog"]')).toBe(screen.getByRole('dialog'))

    fireEvent.click(screen.getByRole('button', { name: 'select mock model' }))

    await waitFor(() => expect(testState.setModel).toHaveBeenCalledWith('openai::gpt-4o'))
  })

  it('does not pass malformed stored model ids to the shared model selector', async () => {
    testState.selectedCliTool = codeCLI.qwenCode
    testState.selectedModel = 'legacy-model-id'

    await openCodeToolDialog()

    expect(latestModelSelectorProps().value).toBeUndefined()
  })

  it('keeps the code-cli provider and model filter when using the shared model selector', async () => {
    testState.selectedCliTool = codeCLI.qwenCode
    testState.providers = [
      makeProvider('openai'),
      makeProvider('anthropic', ENDPOINT_TYPE.ANTHROPIC_MESSAGES),
      makeProvider('cherryai')
    ]
    const chatModel = makeModel('openai::gpt-4o', 'openai', {
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    })
    const anthropicModel = makeModel('anthropic::claude-3-5-sonnet', 'anthropic', {
      endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
    })
    const embeddingModel = makeModel('openai::text-embedding-3-small', 'openai', {
      capabilities: [MODEL_CAPABILITY.EMBEDDING],
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    })
    const rerankModel = makeModel('openai::rerank', 'openai', {
      capabilities: [MODEL_CAPABILITY.RERANK],
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    })
    const imageModel = makeModel('openai::image', 'openai', {
      capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    })
    const cherryAiModel = makeModel('cherryai::gpt-4o', 'cherryai', {
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    })

    await openCodeToolDialog()

    const filter = latestModelSelectorProps().filter as (model: Model) => boolean
    expect(filter(chatModel)).toBe(true)
    expect(filter(anthropicModel)).toBe(false)
    expect(filter(embeddingModel)).toBe(false)
    expect(filter(rerankModel)).toBe(false)
    expect(filter(imageModel)).toBe(false)
    expect(filter(cherryAiModel)).toBe(false)
  })

  it('keeps the OpenCode provider fallback equivalent to the pre-v2 frontend filter', async () => {
    testState.selectedCliTool = codeCLI.openCode
    testState.providers = [
      makeProvider('openai-chat', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS),
      makeProvider('new-api', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, {
        presetProviderId: 'new-api',
        defaultChatEndpoint: undefined
      }),
      makeProvider('anthropic', ENDPOINT_TYPE.ANTHROPIC_MESSAGES),
      makeProvider('gateway', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, {
        presetProviderId: 'gateway',
        defaultChatEndpoint: undefined
      })
    ]

    await openCodeToolDialog()

    const filter = latestModelSelectorProps().filter as (model: Model) => boolean
    expect(filter(makeModel('openai-chat::gpt-4o', 'openai-chat'))).toBe(true)
    expect(filter(makeModel('new-api::claude-3-5-sonnet', 'new-api'))).toBe(true)
    expect(filter(makeModel('anthropic::claude-3-5-sonnet', 'anthropic'))).toBe(true)
    expect(
      filter(
        makeModel('gateway::gpt-4o', 'gateway', {
          endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
        })
      )
    ).toBe(false)
  })

  it('does not render the model selector for GitHub Copilot CLI', async () => {
    testState.selectedCliTool = codeCLI.githubCopilotCli

    await openCodeToolDialog()

    expect(screen.queryByTestId('code-model-selector')).not.toBeInTheDocument()
  })

  it('keeps the auto-update checkbox neutral instead of primary themed', async () => {
    await openCodeToolDialog()

    const checkbox = await screen.findByRole('checkbox')

    // Behavioral guard: page must not theme the auto-update checkbox with the global primary token.
    expect(checkbox.className).not.toMatch(/primary/)
    expect(screen.getByText('code.auto_update_to_latest')).toHaveClass('font-normal')
  })

  it('disables launch when the tool cannot launch', async () => {
    testState.canLaunch = false

    await openCodeToolDialog()

    expect(screen.getByRole('button', { name: 'code.launch.label' })).toBeDisabled()
  })

  it('disables launch when bun is not installed', async () => {
    testState.isBunInstalled = false

    await openCodeToolDialog()

    expect(screen.getByRole('button', { name: 'code.launch.label' })).toBeDisabled()
  })

  it('shows launching state and prevents duplicate launch submissions', async () => {
    let resolveRun!: (value: { success: boolean }) => void
    testState.codeCliRun.mockReturnValue(
      new Promise<{ success: boolean }>((resolve) => {
        resolveRun = resolve
      })
    )

    await openCodeToolDialog()

    const launchButton = screen.getByRole('button', { name: 'code.launch.label' })
    fireEvent.click(launchButton)

    const launchingButton = await screen.findByRole('button', { name: 'code.launching' })
    expect(launchingButton).toBeDisabled()
    fireEvent.click(launchingButton)
    expect(testState.codeCliRun).toHaveBeenCalledTimes(1)

    resolveRun({ success: true })
    await waitFor(() => expect(window.toast.success).toHaveBeenCalledWith('code.launch.success'))
  })

  it('shows launched state after a successful launch and schedules reset', async () => {
    await openCodeToolDialog()

    fireEvent.click(screen.getByRole('button', { name: 'code.launch.label' }))

    expect(await screen.findByRole('button', { name: /code.launch.launched/ })).toBeEnabled()
    expect(testState.setTimeoutTimer).toHaveBeenCalledWith('launchSuccess', expect.any(Function), 2500)
  })

  it('returns to idle and shows an error when launch fails', async () => {
    testState.codeCliRun.mockResolvedValue({ success: false, message: 'launch failed' })

    await openCodeToolDialog()

    fireEvent.click(screen.getByRole('button', { name: 'code.launch.label' }))

    await waitFor(() => expect(window.toast.error).toHaveBeenCalledWith('launch failed'))
    expect(screen.getByRole('button', { name: 'code.launch.label' })).toBeEnabled()
  })
})
