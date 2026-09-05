import '@testing-library/jest-dom/vitest'

import { diagnosticsErrorCodes } from '@shared/ipc/errors/diagnostics'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { OutputFor } from '@shared/ipc/types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  request: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.request }
}))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: { withContext: () => ({ error: mocks.loggerError }) }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: mocks.toastError, success: vi.fn() }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import DiagnosticBundlePanel from '@renderer/components/feedback/DiagnosticBundlePanel'

const inspectResult: OutputFor<'diagnostics.bundle.inspect'> = {
  hasWarnings: false,
  sourceLimitBytes: 50 * 1024 * 1024,
  sources: {
    chatRecords: { available: true, estimatedBytes: 1_024, messageCount: 1 },
    crashDumps: { fileCount: 0 },
    logs: { available: true, estimatedBytes: 1_024, fileCount: 1 },
    traces: { available: false, estimatedBytes: 0, fileCount: 0 }
  }
}

describe('DiagnosticBundlePanel export errors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('electron', { process: { platform: 'darwin' } })
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') return inspectResult
      if (route === 'diagnostics.bundle.export') {
        throw new IpcError(diagnosticsErrorCodes.DESTINATION_INSIDE_SOURCE)
      }
      return undefined
    })
  })

  it('explains how to recover when the selected destination conflicts with diagnostic data', async () => {
    const user = userEvent.setup()
    render(<DiagnosticBundlePanel appVersion="2.0.0" onClose={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'settings.about.diagnostics.actions.export' })).toBeEnabled()
    )

    await user.click(screen.getByRole('button', { name: 'settings.about.diagnostics.actions.export' }))
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'settings.about.diagnostics.actions.export' }))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('settings.about.diagnostics.errors.destination_conflict')
    )
  })
})
