import '@testing-library/jest-dom/vitest'

import { codeCLI, terminalApps } from '@shared/config/constant'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  isBunInstalled: true,
  selectedCliTool: 'github-copilot-cli',
  canLaunch: true,
  codeCliRun: vi.fn(),
  setTimeoutTimer: vi.fn()
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

vi.mock('@renderer/aiCore', () => ({
  AiProvider: class {
    getBaseURL() {
      return ''
    }
    getApiKey() {
      return ''
    }
  }
}))

vi.mock('@renderer/components/app/Navbar', () => ({
  Navbar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  NavbarCenter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: () => null
}))

vi.mock('@renderer/config/constant', () => ({
  isMac: false,
  isWin: false
}))

vi.mock('@renderer/config/models', () => ({
  isEmbeddingModel: () => false,
  isRerankModel: () => false,
  isTextToImageModel: () => false
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  usePersistCache: () => [testState.isBunInstalled, vi.fn()]
}))

vi.mock('@renderer/hooks/useCodeCli', () => ({
  useCodeCli: () => ({
    selectedCliTool: testState.selectedCliTool as codeCLI,
    selectedModel: null,
    selectedTerminal: terminalApps.systemDefault,
    environmentVariables: '',
    directories: [],
    currentDirectory: '',
    canLaunch: testState.canLaunch,
    setCliTool: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    setTerminal: vi.fn(),
    setEnvVars: vi.fn(),
    setCurrentDir: vi.fn().mockResolvedValue(undefined),
    removeDir: vi.fn().mockResolvedValue(undefined),
    selectFolder: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: [] })
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: testState.setTimeoutTimer })
}))

vi.mock('@renderer/services/AssistantService', () => ({
  getAssistantSettings: () => ({}),
  getProviderByModel: vi.fn()
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

vi.mock('@renderer/services/ModelService', () => ({
  getModelUniqId: (model: { id: string }) => model.id
}))

vi.mock('@renderer/store', () => ({
  useAppSelector: () => null
}))

vi.mock('@renderer/utils/naming', () => ({
  getFancyProviderName: (provider: { name?: string; id?: string }) => provider.name ?? provider.id ?? '',
  sanitizeProviderName: (name: string) => name
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
  testState.canLaunch = true
  testState.codeCliRun.mockResolvedValue({ success: true })
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
  fireEvent.click(screen.getByRole('button', { name: 'open tool' }))
  await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
}

describe('CodeCliPage', () => {
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
