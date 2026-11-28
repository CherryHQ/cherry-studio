import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as AppErrorDetailService from '@renderer/services/AppErrorDetailService'
import { CodeCli } from '@shared/types/codeCli'

import { useLaunchDialogController } from '../../hooks/useLaunchDialogController'
import { LaunchDialog } from '../LaunchDialog'

const { requestMock, toastError, openErrorDetail } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  toastError: vi.fn(),
  openErrorDetail: vi.fn().mockResolvedValue('opened')
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: requestMock } }))
vi.mock('@renderer/services/toast', () => ({ toast: { error: toastError, success: vi.fn() } }))
vi.mock('@renderer/services/AppErrorDetailService', async (importOriginal) => ({
  ...(await importOriginal<typeof AppErrorDetailService>()),
  appErrorDetailService: { openAppErrorDetail: openErrorDetail }
}))
vi.mock('../../hooks/useAvailableTerminals', () => ({ useAvailableTerminals: () => [] }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

function LaunchHarness() {
  const controller = useLaunchDialogController({
    selectedCliTool: CodeCli.QODER_CLI,
    toolName: 'Qoder',
    directory: '/tmp/project',
    isOwnLoginSelected: false,
    gatewayModelsById: new Map(),
    modelById: new Map(),
    isModelsLoading: false,
    upsertProviderConfig: vi.fn(),
    setCurrentProvider: vi.fn(),
    setTerminal: vi.fn(),
    selectFolder: vi.fn()
  })
  return (
    <>
      <button type="button" onClick={controller.openLaunchDialog}>
        open-launch
      </button>
      <LaunchDialog {...controller.launchDialogProps} />
    </>
  )
}

describe('LaunchDialog failures', () => {
  beforeEach(() => {
    requestMock.mockReset()
    toastError.mockClear()
    openErrorDetail.mockClear()
  })

  // The dialog traps focus, so a Details entry that only lives in the window-level toast is unreachable by keyboard.
  it('keeps a refused launch inside the dialog with keyboard-reachable Details and a retry', async () => {
    requestMock
      .mockResolvedValueOnce({ success: false, message: 'spawn osascript ENOENT' })
      .mockResolvedValueOnce({ success: true })
    const user = userEvent.setup()
    render(<LaunchHarness />)

    await user.click(screen.getByRole('button', { name: 'open-launch' }))
    await user.click(screen.getByRole('button', { name: 'code.launch.label' }))

    const alert = await within(screen.getByRole('dialog')).findByRole('alert')
    expect(alert).toHaveTextContent('code.launch.error')
    expect(alert).not.toHaveTextContent('spawn osascript ENOENT')
    expect(toastError).not.toHaveBeenCalled()

    const details = within(alert).getByRole('button', { name: 'common.detail' })
    for (let step = 0; step < 10 && document.activeElement !== details; step++) await user.tab()
    expect(details).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(openErrorDetail).toHaveBeenCalledTimes(1))
    expect(openErrorDetail.mock.calls[0][0].context).toMatchObject({
      message: 'spawn osascript ENOENT',
      operation: 'code_cli.run',
      source: 'code.launch'
    })
    expect(openErrorDetail.mock.calls[0][0].localizedErrorMessage).toBe('code.launch.error')

    const launch = screen.getByRole('button', { name: 'code.launch.label' })
    for (let step = 0; step < 10 && document.activeElement !== launch; step++) await user.tab()
    expect(launch).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(requestMock).toHaveBeenCalledTimes(2)
  })

  it('keeps a thrown launch rejection inside the dialog and drops it when the dialog is reopened', async () => {
    requestMock.mockRejectedValueOnce(new Error('cli ipc rejected'))
    const user = userEvent.setup()
    render(<LaunchHarness />)

    await user.click(screen.getByRole('button', { name: 'open-launch' }))
    await user.click(screen.getByRole('button', { name: 'code.launch.label' }))

    const alert = await within(screen.getByRole('dialog')).findByRole('alert')
    await user.click(within(alert).getByRole('button', { name: 'common.detail' }))
    await waitFor(() => expect(openErrorDetail).toHaveBeenCalledTimes(1))
    expect(openErrorDetail.mock.calls[0][0].context).toMatchObject({
      message: 'cli ipc rejected',
      operation: 'code_cli.run',
      source: 'code.launch'
    })
    expect(toastError).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'common.cancel' }))
    await user.click(screen.getByRole('button', { name: 'open-launch' }))
    expect(within(screen.getByRole('dialog')).queryByRole('alert')).not.toBeInTheDocument()
  })
})
