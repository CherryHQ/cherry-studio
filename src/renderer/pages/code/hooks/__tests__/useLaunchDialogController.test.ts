import type { Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  availableTerminals: [] as { id: string; name: string }[],
  requestMock: vi.fn(),
  resolveCliConfigApplyContext: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.requestMock }
}))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../cliConfig', () => ({
  resolveCliConfigApplyContext: mocks.resolveCliConfigApplyContext
}))

vi.mock('../useAvailableTerminals', () => ({
  useAvailableTerminals: () => mocks.availableTerminals
}))

const { useLaunchDialogController } = await import('../useLaunchDialogController')

const enabledProvider = { id: 'anthropic', name: 'Anthropic' } as Provider

describe('useLaunchDialogController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.availableTerminals = [
      { id: 'terminal', name: 'Terminal' },
      { id: 'iterm2', name: 'iTerm2' }
    ]
    mocks.requestMock.mockResolvedValue({ success: true, message: '' })
    mocks.resolveCliConfigApplyContext.mockReturnValue({
      modelId: 'anthropic::claude-sonnet-4-5',
      providerId: 'anthropic',
      rawModelId: 'claude-sonnet-4-5',
      writePrimaryModel: true
    })
  })

  // Regression: the picker (CurrentConfigPanel) falls back to `terminals[0]` for display when the
  // user has never picked one, but launch used to send the raw (unresolved) preference — silently
  // launching a different terminal than the one shown as selected.
  it('resolves the picker fallback into the launch payload instead of sending undefined', async () => {
    const { result } = renderHook(() =>
      useLaunchDialogController({
        selectedCliTool: CodeCli.CLAUDE_CODE,
        toolName: 'Claude Code',
        directory: '/tmp/project',
        enabledProvider,
        isOwnLoginSelected: false,
        currentProviderConfig: { modelId: 'anthropic::claude-sonnet-4-5' },
        selectedTerminal: undefined,
        upsertProviderConfig: vi.fn(),
        setCurrentProvider: vi.fn(),
        setTerminal: vi.fn(),
        selectFolder: vi.fn()
      })
    )

    expect(result.current.launchDialogProps.selectedTerminal).toBe('terminal')

    await act(async () => {
      result.current.launchDialogProps.onLaunch()
    })

    expect(mocks.requestMock).toHaveBeenCalledWith(
      'code_cli.run',
      expect.objectContaining({ options: expect.objectContaining({ terminal: 'terminal' }) })
    )
  })

  it('uses the persisted terminal for both display and launch once the user has picked one', async () => {
    const { result } = renderHook(() =>
      useLaunchDialogController({
        selectedCliTool: CodeCli.CLAUDE_CODE,
        toolName: 'Claude Code',
        directory: '/tmp/project',
        enabledProvider,
        isOwnLoginSelected: false,
        currentProviderConfig: { modelId: 'anthropic::claude-sonnet-4-5' },
        selectedTerminal: 'iterm2',
        upsertProviderConfig: vi.fn(),
        setCurrentProvider: vi.fn(),
        setTerminal: vi.fn(),
        selectFolder: vi.fn()
      })
    )

    expect(result.current.launchDialogProps.selectedTerminal).toBe('iterm2')

    await act(async () => {
      result.current.launchDialogProps.onLaunch()
    })

    expect(mocks.requestMock).toHaveBeenCalledWith(
      'code_cli.run',
      expect.objectContaining({ options: expect.objectContaining({ terminal: 'iterm2' }) })
    )
  })

  it('resolves the same fallback for provider-less launches', async () => {
    const { result } = renderHook(() =>
      useLaunchDialogController({
        selectedCliTool: CodeCli.QODER_CLI,
        toolName: 'Qoder',
        directory: '/tmp/project',
        isOwnLoginSelected: false,
        selectedTerminal: undefined,
        upsertProviderConfig: vi.fn(),
        setCurrentProvider: vi.fn(),
        setTerminal: vi.fn(),
        selectFolder: vi.fn()
      })
    )

    await act(async () => {
      result.current.launchDialogProps.onLaunch()
    })

    expect(mocks.requestMock).toHaveBeenCalledWith(
      'code_cli.run',
      expect.objectContaining({ options: expect.objectContaining({ terminal: 'terminal' }) })
    )
  })
})
