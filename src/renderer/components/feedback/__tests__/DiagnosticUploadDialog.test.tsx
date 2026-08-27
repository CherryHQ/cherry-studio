// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { diagnosticsErrorCodes } from '@shared/ipc/errors/diagnostics'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { OutputFor } from '@shared/ipc/types'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { DIAGNOSTIC_FEEDBACK_FORM_URL } from '@shared/utils/diagnostics'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  request: vi.fn(),
  toastError: vi.fn(),
  translations: {
    'settings.about.diagnostics.actions.cancel': 'Cancel',
    'settings.about.diagnostics.actions.close': 'Close',
    'settings.about.diagnostics.actions.reveal': 'Show in folder',
    'settings.about.diagnostics.inspecting': 'Inspecting diagnostic data…',
    'settings.about.diagnostics.report.acknowledgement':
      'I understand that the description and selected diagnostic data will be sent privately to Cherry.',
    'settings.about.diagnostics.report.copy_id': 'Copy feedback ID',
    'settings.about.diagnostics.report.description_label': 'Problem description',
    'settings.about.diagnostics.report.description_required': 'A problem description is required',
    'settings.about.diagnostics.report.description_too_long': 'The problem description is too long',
    'settings.about.diagnostics.report.failure_reasons.service_unavailable': 'The report service is unavailable.',
    'settings.about.diagnostics.report.feedback_id': 'Feedback ID',
    'settings.about.diagnostics.report.open_manual_form': 'Manual feedback',
    'settings.about.diagnostics.report.retry': 'Retry',
    'settings.about.diagnostics.report.retry_unknown_description':
      'The previous submission may already have succeeded. Retrying can create a duplicate report.',
    'settings.about.diagnostics.report.retry_unknown_title': 'Retry diagnostic report?',
    'settings.about.diagnostics.report.submitting': 'Submitting diagnostic report…',
    'settings.about.diagnostics.report.success_title': 'Diagnostic report submitted',
    'settings.about.diagnostics.ranges.3d': 'Last 3 days',
    'settings.about.diagnostics.sources.logs.title': 'App logs',
    'settings.about.diagnostics.sources.traces.title': 'Detailed activity records',
    'settings.about.diagnostics.upload.actions.consent_upload': 'Submit diagnostic report',
    'settings.about.diagnostics.upload.dialog.title': 'Upload diagnostic bundle',
    'settings.about.diagnostics.upload.manual.title': 'Diagnostic report was not submitted',
    'settings.about.diagnostics.upload.unknown.title': 'Submission result is unknown'
  } as Record<string, string>
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())

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
  useTranslation: () => ({ t: (key: string) => mocks.translations[key] ?? key })
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

const bundleId = '9de71f3c-f4cf-4311-a3f3-86f12a930451'
const reportId = 'df543a7e-5a76-4624-b42d-ed7b997d943e'
const fallbackPath = AbsoluteFilePathSchema.parse('/tmp/cherry-studio-diagnostics.zip')
const bundleSummary = {
  archiveBytes: 2_000,
  bundleId,
  hasWarnings: false,
  includedFileCount: 2,
  omittedFileCount: 0
}

const uploadedResult: Extract<OutputFor<'diagnostics.bundle.upload'>, { status: 'uploaded' }> = {
  ...bundleSummary,
  reportId,
  status: 'uploaded'
}

const submissionFailedResult: Extract<OutputFor<'diagnostics.bundle.upload'>, { status: 'submission_failed' }> = {
  ...bundleSummary,
  fileName: 'cherry-studio-diagnostics.zip',
  filePath: fallbackPath,
  reason: 'service_unavailable',
  status: 'submission_failed'
}

const submissionUnknownResult: Extract<OutputFor<'diagnostics.bundle.upload'>, { status: 'submission_unknown' }> = {
  ...bundleSummary,
  fileName: 'cherry-studio-diagnostics.zip',
  filePath: fallbackPath,
  status: 'submission_unknown'
}

async function completeReview(user: ReturnType<typeof userEvent.setup>, description = '  App freezes on launch.  ') {
  await user.type(screen.getByRole('textbox', { name: 'Problem description' }), description)
  await user.click(
    screen.getByRole('checkbox', {
      name: 'I understand that the description and selected diagnostic data will be sent privately to Cherry.'
    })
  )
  await waitFor(() => expect(screen.getByRole('button', { name: 'Submit diagnostic report' })).toBeEnabled())
}

describe('DiagnosticUploadDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') return inspectResult
      if (route === 'diagnostics.bundle.upload') return uploadedResult
      return undefined
    })
  })

  it('shows no description validation state when an empty dialog opens', async () => {
    render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)

    const description = screen.getByRole('textbox', { name: 'Problem description' })
    expect(description).toHaveAttribute('aria-invalid', 'false')
    expect(description).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByText('A problem description is required')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Inspecting diagnostic data…')).not.toBeInTheDocument())
  })

  it('validates an empty description on submit and keeps the error current while editing', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)

    const submit = screen.getByRole('button', { name: 'Submit diagnostic report' })
    const description = screen.getByRole('textbox', { name: 'Problem description' })
    const acknowledgement = screen.getByRole('checkbox', {
      name: 'I understand that the description and selected diagnostic data will be sent privately to Cherry.'
    })

    await user.click(acknowledgement)
    await waitFor(() => expect(submit).toBeEnabled())
    await user.click(submit)

    expect(description).toHaveAttribute('aria-invalid', 'true')
    expect(description).toHaveAttribute('aria-describedby', 'diagnostic-description-error')
    expect(screen.getByText('A problem description is required')).toBeInTheDocument()
    expect(mocks.request.mock.calls.filter(([route]) => route === 'diagnostics.bundle.upload')).toHaveLength(0)

    await user.type(description, 'App freezes on launch.')
    expect(description).toHaveAttribute('aria-invalid', 'false')
    expect(description).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByText('A problem description is required')).not.toBeInTheDocument()

    await user.clear(description)
    expect(screen.getByText('A problem description is required')).toBeInTheDocument()

    rerender(<DiagnosticUploadDialog open={false} onOpenChange={vi.fn()} />)
    rerender(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)

    const reopenedDescription = screen.getByRole('textbox', { name: 'Problem description' })
    expect(reopenedDescription).toHaveValue('')
    expect(reopenedDescription).toHaveAttribute('aria-invalid', 'false')
    expect(screen.queryByText('A problem description is required')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Inspecting diagnostic data…')).not.toBeInTheDocument())
  })

  it('validates an overlong description only after submit', async () => {
    const user = userEvent.setup()
    render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)

    const submit = screen.getByRole('button', { name: 'Submit diagnostic report' })
    const description = screen.getByRole('textbox', { name: 'Problem description' })
    await user.click(description)
    await user.paste('x'.repeat(4097))
    await user.click(
      screen.getByRole('checkbox', {
        name: 'I understand that the description and selected diagnostic data will be sent privately to Cherry.'
      })
    )

    expect(screen.queryByText('The problem description is too long')).not.toBeInTheDocument()
    await waitFor(() => expect(submit).toBeEnabled())
    await user.click(submit)

    expect(screen.getByText('The problem description is too long')).toBeInTheDocument()
    expect(mocks.request.mock.calls.filter(([route]) => route === 'diagnostics.bundle.upload')).toHaveLength(0)
  })

  it('submits a trimmed valid description', async () => {
    const user = userEvent.setup()
    render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)

    await completeReview(user)
    const description = screen.getByRole('textbox', { name: 'Problem description' })
    const acknowledgement = screen.getByRole('checkbox', {
      name: 'I understand that the description and selected diagnostic data will be sent privately to Cherry.'
    })

    await user.type(description, ' Please investigate. ')
    expect(acknowledgement).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Submit diagnostic report' }))

    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.upload', {
        description: 'App freezes on launch.   Please investigate.',
        includeLogs: true,
        includeTraces: true,
        range: '24h'
      })
    )
  })

  it('invalidates acknowledgement whenever the selected diagnostic data changes', async () => {
    const user = userEvent.setup()
    render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)
    await completeReview(user)

    const acknowledgement = screen.getByRole('checkbox', {
      name: 'I understand that the description and selected diagnostic data will be sent privately to Cherry.'
    })
    await user.click(screen.getByRole('radio', { name: 'Last 3 days' }))
    expect(acknowledgement).not.toBeChecked()

    await user.click(acknowledgement)
    await user.click(screen.getByRole('switch', { name: 'App logs' }))
    expect(acknowledgement).not.toBeChecked()

    await user.click(acknowledgement)
    await user.click(screen.getByRole('switch', { name: 'Detailed activity records' }))
    expect(acknowledgement).not.toBeChecked()
  })

  it('locks every dismissal path while submitting and shows only the API feedback ID on success', async () => {
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
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    const clipboardWrite = vi.spyOn(navigator.clipboard, 'writeText')
    render(<DiagnosticUploadDialog open onOpenChange={onOpenChange} />)
    await completeReview(user)

    await user.click(screen.getByRole('button', { name: 'Submit diagnostic report' }))

    expect(screen.getByRole('button', { name: 'Submitting diagnostic report…' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    const overlay = document.querySelector<HTMLElement>('[data-ui~="part:dialog-overlay"]')
    expect(overlay).not.toBeNull()
    await user.click(overlay!)
    expect(onOpenChange).not.toHaveBeenCalled()

    resolveUpload(uploadedResult)
    expect(await screen.findByText('Diagnostic report submitted')).toBeInTheDocument()
    expect(screen.getByText('Feedback ID')).toBeInTheDocument()
    expect(screen.getByText(reportId)).toBeInTheDocument()
    expect(screen.queryByText(bundleId)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copy feedback ID' }))
    expect(clipboardWrite).toHaveBeenCalledWith(reportId)
  })

  it('offers explicit recovery actions for a rejected submission without opening the manual form automatically', async () => {
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') return inspectResult
      if (route === 'diagnostics.bundle.upload') return submissionFailedResult
      if (route === 'diagnostics.bundle.retry_upload') return uploadedResult
      return undefined
    })
    const user = userEvent.setup()
    render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)
    await completeReview(user)
    await user.click(screen.getByRole('button', { name: 'Submit diagnostic report' }))

    expect(await screen.findByText('Diagnostic report was not submitted')).toBeInTheDocument()
    expect(screen.getByText('The report service is unavailable.')).toBeInTheDocument()
    expect(mocks.request).not.toHaveBeenCalledWith('system.shell.open_website', DIAGNOSTIC_FEEDBACK_FORM_URL)

    await user.click(screen.getByRole('button', { name: 'Show in folder' }))
    expect(mocks.request).toHaveBeenCalledWith('file.show_in_folder', { kind: 'path', path: fallbackPath })
    const manualFeedback = screen.getByRole('button', { name: 'Manual feedback' })
    const retry = screen.getByRole('button', { name: 'Retry' })
    expect(manualFeedback.compareDocumentPosition(retry)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    await user.click(manualFeedback)
    expect(mocks.request).toHaveBeenCalledWith('system.shell.open_website', DIAGNOSTIC_FEEDBACK_FORM_URL)
    await user.click(retry)
    expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.retry_upload', { bundleId })
    expect(await screen.findByText(reportId)).toBeInTheDocument()
  })

  it('requires duplicate-risk confirmation before retrying an unknown submission and keeps retry locked', async () => {
    let resolveRetry: (result: typeof uploadedResult) => void = () => undefined
    mocks.request.mockImplementation((route: string) => {
      if (route === 'diagnostics.bundle.inspect') return Promise.resolve(inspectResult)
      if (route === 'diagnostics.bundle.upload') return Promise.resolve(submissionUnknownResult)
      if (route === 'diagnostics.bundle.retry_upload') {
        return new Promise((resolve) => {
          resolveRetry = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(<DiagnosticUploadDialog open onOpenChange={onOpenChange} />)
    await completeReview(user)
    await user.click(screen.getByRole('button', { name: 'Submit diagnostic report' }))

    expect(await screen.findByText('Submission result is unknown')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Manual feedback' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show in folder' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    let confirmation = screen.getByRole('dialog', { name: 'Retry diagnostic report?' })
    expect(confirmation).toHaveTextContent(
      'The previous submission may already have succeeded. Retrying can create a duplicate report.'
    )
    await user.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
    expect(mocks.request.mock.calls.filter(([route]) => route === 'diagnostics.bundle.retry_upload')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    confirmation = screen.getByRole('dialog', { name: 'Retry diagnostic report?' })
    await user.click(within(confirmation).getByRole('button', { name: 'Retry' }))
    expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.retry_upload', { bundleId })
    expect(screen.getByRole('button', { name: 'Submitting diagnostic report…' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onOpenChange).not.toHaveBeenCalled()

    resolveRetry(uploadedResult)
    expect(await screen.findByText(reportId)).toBeInTheDocument()
  })

  it.each([
    [diagnosticsErrorCodes.FALLBACK_SAVE_FAILED, 'Submit diagnostic report'],
    [diagnosticsErrorCodes.SUBMISSION_UNKNOWN_FALLBACK_SAVE_FAILED, 'Close']
  ])('does not report success when preserving a failed upload throws %s', async (errorCode, recoveryAction) => {
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') return inspectResult
      if (route === 'diagnostics.bundle.upload') throw new IpcError(errorCode)
      return undefined
    })
    const user = userEvent.setup()
    render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)
    await completeReview(user)
    await user.click(screen.getByRole('button', { name: 'Submit diagnostic report' }))

    await waitFor(() => expect(screen.getAllByRole('button', { name: recoveryAction }).length).toBeGreaterThan(0))
    expect(screen.queryByText('Diagnostic report submitted')).not.toBeInTheDocument()
    expect(screen.queryByText(reportId)).not.toBeInTheDocument()
  })
})
