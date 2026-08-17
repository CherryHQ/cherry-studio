// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { diagnosticsErrorCodes } from '@shared/ipc/errors/diagnostics'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { OutputFor } from '@shared/ipc/types'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { DIAGNOSTIC_FEEDBACK_FORM_URL } from '@shared/utils/diagnostics'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  request: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (...args: unknown[]) => mocks.request(...args) }
}))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: { withContext: () => ({ error: mocks.loggerError }) }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: (...args: unknown[]) => mocks.toastError(...args) }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import DiagnosticUploadDialog from '../DiagnosticUploadDialog'

const inspectResult: OutputFor<'diagnostics.bundle.inspect'> = {
  hasWarnings: false,
  sourceLimitBytes: 50 * 1024 * 1024,
  sources: {
    crashDumps: { fileCount: 1 },
    logs: { available: true, estimatedBytes: 1_024, fileCount: 2 },
    traces: { available: true, estimatedBytes: 2_048, fileCount: 3 }
  }
}

const uploadedResult: Extract<OutputFor<'diagnostics.bundle.upload'>, { status: 'uploaded' }> = {
  archiveBytes: 2_000,
  bundleId: 'bundle-123',
  hasWarnings: false,
  includedFileCount: 2,
  omittedFileCount: 0,
  status: 'uploaded'
}

const fallbackPath = AbsoluteFilePathSchema.parse('/tmp/cherry-studio-diagnostics.zip')

describe('DiagnosticUploadDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') return inspectResult
      if (route === 'diagnostics.bundle.upload') return uploadedResult
      return undefined
    })
  })

  it('shows privacy inline and uses the upload button as the only explicit confirmation', async () => {
    const user = userEvent.setup()
    render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)

    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.inspect', { range: '24h' }))
    expect(screen.getByRole('alert')).toHaveTextContent('settings.about.diagnostics.upload.privacy.title')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'settings.about.diagnostics.upload.actions.consent_upload' }))

    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.upload', {
        includeLogs: true,
        includeTraces: true,
        range: '24h'
      })
    )
    const successStatus = await screen.findByRole('status')
    expect(successStatus).toHaveAttribute('aria-live', 'polite')
    expect(successStatus).toHaveTextContent('settings.about.diagnostics.upload.success.title')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'settings.about.diagnostics.actions.close' })).toHaveFocus()
    )
  })

  it('locks the dialog while upload is in progress', async () => {
    let resolveUpload: (result: typeof uploadedResult) => void = () => undefined
    mocks.request.mockImplementation((route: string) => {
      if (route === 'diagnostics.bundle.inspect') return Promise.resolve(inspectResult)
      if (route === 'diagnostics.bundle.upload') {
        return new Promise((resolve) => {
          resolveUpload = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    const user = userEvent.setup()
    render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)
    const uploadButton = await screen.findByRole('button', {
      name: 'settings.about.diagnostics.upload.actions.consent_upload'
    })

    await user.click(uploadButton)

    expect(screen.getByRole('button', { name: 'settings.about.diagnostics.upload.actions.uploading' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    resolveUpload(uploadedResult)
    expect(await screen.findByText('settings.about.diagnostics.upload.success.title')).toBeInTheDocument()
  })

  it('saves and opens the form automatically for a known fallback', async () => {
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') return inspectResult
      if (route === 'diagnostics.bundle.upload') {
        return {
          fileName: 'cherry-studio-diagnostics.zip',
          filePath: fallbackPath,
          reason: 'form_changed',
          status: 'manual_upload_required'
        }
      }
      return undefined
    })
    const user = userEvent.setup()
    render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)

    await user.click(
      await screen.findByRole('button', { name: 'settings.about.diagnostics.upload.actions.consent_upload' })
    )

    expect(await screen.findByText('settings.about.diagnostics.upload.manual.title')).toBeInTheDocument()
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('system.shell.open_website', DIAGNOSTIC_FEEDBACK_FORM_URL)
    )
    await user.click(screen.getByRole('button', { name: 'settings.about.diagnostics.actions.reveal' }))
    expect(mocks.request).toHaveBeenCalledWith('file.show_in_folder', { kind: 'path', path: fallbackPath })
  })

  it('does not reopen the form automatically when submission may already have succeeded', async () => {
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') return inspectResult
      if (route === 'diagnostics.bundle.upload') {
        return {
          ...uploadedResult,
          fileName: 'cherry-studio-diagnostics.zip',
          filePath: fallbackPath,
          status: 'submission_unknown'
        }
      }
      return undefined
    })
    const user = userEvent.setup()
    render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)

    await user.click(
      await screen.findByRole('button', { name: 'settings.about.diagnostics.upload.actions.consent_upload' })
    )

    expect(await screen.findByText('settings.about.diagnostics.upload.unknown.title')).toBeInTheDocument()
    expect(mocks.request).not.toHaveBeenCalledWith('system.shell.open_website', DIAGNOSTIC_FEEDBACK_FORM_URL)

    await user.click(screen.getByRole('button', { name: 'settings.about.diagnostics.upload.actions.open_form' }))
    expect(mocks.request).toHaveBeenCalledWith('system.shell.open_website', DIAGNOSTIC_FEEDBACK_FORM_URL)
  })

  it('prevents a duplicate upload when an uncertain submission cannot be preserved', async () => {
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') return inspectResult
      if (route === 'diagnostics.bundle.upload') {
        throw new IpcError(diagnosticsErrorCodes.SUBMISSION_UNKNOWN_FALLBACK_SAVE_FAILED)
      }
      return undefined
    })
    const user = userEvent.setup()
    render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)

    await user.click(
      await screen.findByRole('button', { name: 'settings.about.diagnostics.upload.actions.consent_upload' })
    )

    expect(await screen.findByText('settings.about.diagnostics.upload.unknown_without_copy.title')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'settings.about.diagnostics.upload.unknown_without_copy.description'
    )
    expect(
      screen.queryByRole('button', { name: 'settings.about.diagnostics.upload.actions.consent_upload' })
    ).toBeNull()
    expect(screen.queryByRole('button', { name: 'settings.about.diagnostics.actions.reveal' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'settings.about.diagnostics.upload.actions.open_form' })).toBeNull()
    const closeButton = screen.getByRole('button', { name: 'settings.about.diagnostics.actions.close' })
    await waitFor(() => expect(closeButton).toHaveFocus())
    expect(mocks.request).not.toHaveBeenCalledWith('system.shell.open_website', DIAGNOSTIC_FEEDBACK_FORM_URL)
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('keeps a known fallback preservation failure retryable', async () => {
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') return inspectResult
      if (route === 'diagnostics.bundle.upload') {
        throw new IpcError(diagnosticsErrorCodes.FALLBACK_SAVE_FAILED)
      }
      return undefined
    })
    const user = userEvent.setup()
    render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)
    const uploadButton = await screen.findByRole('button', {
      name: 'settings.about.diagnostics.upload.actions.consent_upload'
    })

    await user.click(uploadButton)

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('settings.about.diagnostics.upload.errors.upload_failed')
    )
    expect(uploadButton).toBeEnabled()
  })

  it('returns to idle and reports a concurrent operation as busy', async () => {
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') return inspectResult
      if (route === 'diagnostics.bundle.upload') return { status: 'busy' }
      return undefined
    })
    const user = userEvent.setup()
    render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)
    const uploadButton = await screen.findByRole('button', {
      name: 'settings.about.diagnostics.upload.actions.consent_upload'
    })

    await user.click(uploadButton)

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('settings.about.diagnostics.errors.busy'))
    expect(uploadButton).toBeEnabled()
  })
})
