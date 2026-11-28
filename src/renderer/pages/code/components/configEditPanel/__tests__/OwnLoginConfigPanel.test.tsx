import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CliConfigFileDraft } from '@renderer/pages/code/cliConfig/types'
import type * as AppErrorDetailService from '@renderer/services/AppErrorDetailService'
import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
import { CodeCli } from '@shared/types/codeCli'

import { OwnLoginConfigPanel } from '../OwnLoginConfigPanel'

const { readOwnLoginCliConfigDraftMock, toastErrorMock, openErrorDetailMock } = vi.hoisted(() => ({
  readOwnLoginCliConfigDraftMock: vi.fn(),
  toastErrorMock: vi.fn(),
  openErrorDetailMock: vi.fn()
}))

vi.mock('@renderer/services/AppErrorDetailService', async (importOriginal) => ({
  ...(await importOriginal<typeof AppErrorDetailService>()),
  appErrorDetailService: { openAppErrorDetail: openErrorDetailMock }
}))

const previewFiles: CliConfigFileDraft[] = [
  { target: 'claude-settings', label: 'settings.json', path: '/tmp/settings.json', language: 'json', content: '{}' }
]

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: toastErrorMock }
}))

vi.mock('@cherrystudio/ui', () => ({
  Alert: ({ children, role }: { children: ReactNode; role?: string }) => <div role={role ?? 'alert'}>{children}</div>,
  Button: ({
    children,
    loading,
    size,
    variant,
    ...props
  }: {
    children: ReactNode
    loading?: boolean
    size?: string
    variant?: string
  }) => {
    void loading
    void size
    void variant
    return (
      <button type="button" {...props}>
        {children}
      </button>
    )
  },
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>
}))

vi.mock('@renderer/components/SettingsPrimitives', () => ({
  SettingContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SettingGroup: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  SettingTitle: ({ children }: { children: ReactNode }) => <h3>{children}</h3>
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/pages/code/cliConfig', () => ({
  sanitizeCliConfigBlob: (_cliTool: string, config: Record<string, unknown> | undefined) => config ?? {},
  readOwnLoginCliConfigDraft: (...args: unknown[]) => readOwnLoginCliConfigDraftMock(...args),
  validateCliConfigDraftForWrite: vi.fn()
}))

vi.mock('@renderer/components/icons/CliIcon', () => ({
  CliIcon: () => <span data-testid="cli-icon" />
}))

vi.mock('../AdvancedConfigToggle', () => ({
  // Render children unconditionally so the raw editor is testable without toggling.
  AdvancedConfigToggle: ({ children }: { children: ReactNode }) => <div data-testid="advanced-settings">{children}</div>
}))

vi.mock('../CliConfigEditor', () => ({
  CliConfigEditor: ({
    files,
    onChange
  }: {
    files: CliConfigFileDraft[]
    onChange: (files: CliConfigFileDraft[]) => void
  }) => (
    <button
      type="button"
      data-testid="raw-editor"
      onClick={() => onChange([{ ...files[0], content: '{"edited":true}' }])}>
      edit raw
    </button>
  )
}))

vi.mock('../toolFieldRenderer', () => ({
  renderToolFields: ({ onChange }: { onChange: (next: Record<string, unknown>) => void }) => (
    <button type="button" onClick={() => onChange({ effortLevel: 'high' })}>
      change config
    </button>
  )
}))

function renderPanel(
  onSubmit = vi.fn().mockResolvedValue(undefined),
  providerConfig: CliProviderConfig | null = null,
  onClose = vi.fn()
) {
  render(
    <OwnLoginConfigPanel
      onClose={onClose}
      cliTool={CodeCli.CLAUDE_CODE}
      toolName="Claude Code"
      providerConfig={providerConfig}
      onSubmit={onSubmit}
    />
  )
  return { onSubmit, onClose }
}

describe('OwnLoginConfigPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readOwnLoginCliConfigDraftMock.mockResolvedValue(previewFiles)
  })

  it('keeps save disabled until the tool params change, then submits managed and closes', async () => {
    const { onSubmit, onClose } = renderPanel()
    await waitFor(() => expect(readOwnLoginCliConfigDraftMock).toHaveBeenCalled())

    const saveButton = screen.getByText('common.save')
    expect(saveButton).toBeDisabled()

    fireEvent.click(screen.getByText('change config'))
    await waitFor(() => expect(saveButton).not.toBeDisabled())

    fireEvent.click(saveButton)

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ config: { effortLevel: 'high' }, cliConfigFiles: undefined })
    )
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('submits the hand-edited raw files verbatim when the advanced editor is used', async () => {
    const { onSubmit } = renderPanel()
    await waitFor(() => expect(screen.getByTestId('raw-editor')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('raw-editor'))
    await waitFor(() => expect(screen.getByText('common.save')).not.toBeDisabled())

    fireEvent.click(screen.getByText('common.save'))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        config: {},
        cliConfigFiles: [{ ...previewFiles[0], content: '{"edited":true}' }]
      })
    )
  })

  // The dialog traps focus, so a Details entry that only lives in the window-level toast is unreachable by keyboard.
  it('keeps a failed save inside the dialog with keyboard-reachable Details and clears it on retry', async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error('write failed')).mockResolvedValue(undefined)
    const user = userEvent.setup()
    const { onClose } = renderPanel(onSubmit)
    await waitFor(() => expect(readOwnLoginCliConfigDraftMock).toHaveBeenCalled())

    fireEvent.click(screen.getByText('change config'))
    const saveButton = screen.getByText('common.save')
    await waitFor(() => expect(saveButton).not.toBeDisabled())
    fireEvent.click(saveButton)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('code.apply_failed')
    expect(alert).not.toHaveTextContent('write failed')
    expect(toastErrorMock).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    const details = within(alert).getByRole('button', { name: /common\.detail/ })
    for (let step = 0; step < 20 && document.activeElement !== details; step++) await user.tab()
    expect(details).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(openErrorDetailMock).toHaveBeenCalledTimes(1))
    expect(openErrorDetailMock.mock.calls[0][0].context).toMatchObject({
      message: 'write failed',
      operation: 'code_cli.save_own_login_config',
      source: 'code.config'
    })

    // The user's edits survive: the panel is still savable for a retry.
    await user.click(saveButton)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('prefills from the saved own-login config so an unchanged panel cannot be saved', async () => {
    renderPanel(vi.fn().mockResolvedValue(undefined), { modelId: null, config: { effortLevel: 'high' } })
    await waitFor(() => expect(readOwnLoginCliConfigDraftMock).toHaveBeenCalled())

    expect(screen.getByText('common.save')).toBeDisabled()
  })
})
