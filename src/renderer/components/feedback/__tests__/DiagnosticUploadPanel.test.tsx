// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { diagnosticsErrorCodes } from '@shared/ipc/errors/diagnostics'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { OutputFor } from '@shared/ipc/types'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { DIAGNOSTIC_FEEDBACK_FORM_URL } from '@shared/utils/diagnostics'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  request: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  translations: {
    'settings.about.diagnostics.actions.cancel': 'Cancel',
    'settings.about.diagnostics.actions.close': 'Close',
    'common.delete': 'Delete',
    'common.loading': 'Loading...',
    'settings.about.diagnostics.actions.reveal': 'Show in folder',
    'settings.about.diagnostics.errors.busy': 'Another diagnostic bundle operation is already in progress',
    'settings.about.diagnostics.inspecting': 'Inspecting diagnostic data…',
    'settings.about.diagnostics.report.acknowledgement':
      'I understand that the problem description and selected diagnostic data may contain sensitive information, and agree to send this content to Cherry Studio for troubleshooting.',
    'settings.about.diagnostics.report.copy_id': 'Copy feedback ID',
    'settings.about.diagnostics.report.description_label': 'Problem description',
    'settings.about.diagnostics.report.description_required': 'A problem description is required',
    'settings.about.diagnostics.report.description_too_long': 'The problem description is too long',
    'settings.about.diagnostics.report.failure_reasons.service_unavailable':
      'The diagnostic report service is temporarily unavailable. Try again later or use manual feedback.',
    'settings.about.diagnostics.report.feedback_id': 'Feedback ID',
    'settings.about.diagnostics.report.open_location': 'Open location',
    'settings.about.diagnostics.report.open_manual_form': 'Manual feedback',
    'settings.about.diagnostics.report.retry': 'Retry',
    'settings.about.diagnostics.report.save_locally': 'Save locally',
    'settings.about.diagnostics.report.saving': 'Saving diagnostic report…',
    'settings.about.diagnostics.report.submitting': 'Submitting diagnostic report…',
    'settings.about.diagnostics.report.success_title': 'Diagnostic report submitted',
    'settings.about.diagnostics.report.saved_locally': 'Saved locally',
    'settings.about.diagnostics.range_title': 'Time range',
    'settings.about.diagnostics.ranges.24h': 'Last 24 hours',
    'settings.about.diagnostics.ranges.3d': 'Last 3 days',
    'settings.about.diagnostics.ranges.7d': 'Last 7 days',
    'settings.about.diagnostics.sources.chat_records.title': 'Chat history',
    'settings.about.diagnostics.sources.logs.title': 'App logs',
    'settings.about.diagnostics.sources.traces.title': 'Detailed activity records',
    'settings.about.diagnostics.upload.actions.consent_upload': 'Submit diagnostic report',
    'settings.about.diagnostics.upload.errors.discard_failed': 'Could not close the problem report. Try again.',
    'settings.about.diagnostics.upload.errors.save_failed': 'Could not save the diagnostic report',
    'settings.about.diagnostics.upload.manual.title': 'Diagnostic report was not submitted',
    'settings.about.diagnostics.upload.unknown.description':
      'Could not confirm whether this submission succeeded. Save the diagnostic file locally, then contact the Cherry Studio support team or upload it through the Feishu form via Manual feedback. Retrying may submit the same diagnostic report again.',
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
  toast: {
    error: (...args: unknown[]) => mocks.toastError(...args),
    success: (...args: unknown[]) => mocks.toastSuccess(...args)
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => mocks.translations[key] ?? key })
}))

import { DiagnosticUploadPanel } from '../DiagnosticUploadPanel'

const inspectResult: OutputFor<'diagnostics.bundle.inspect'> = {
  hasWarnings: false,
  sourceLimitBytes: 50 * 1024 * 1024,
  sources: {
    chatRecords: { available: true, estimatedBytes: 4_096, messageCount: 4 },
    crashDumps: { fileCount: 1 },
    logs: { available: true, estimatedBytes: 1_024, fileCount: 2 },
    traces: { available: true, estimatedBytes: 2_048, fileCount: 3 }
  }
}

const bundleId = '9de71f3c-f4cf-4311-a3f3-86f12a930451'
const reportId = 'opaque-report-id'
const fallbackPath = AbsoluteFilePathSchema.parse('/tmp/cherry-studio-diagnostics.zip')

const uploadedResult: Extract<OutputFor<'diagnostics.bundle.upload'>, { status: 'uploaded' }> = {
  reportId,
  status: 'uploaded'
}

const submissionFailedResult: Extract<OutputFor<'diagnostics.bundle.upload'>, { status: 'submission_failed' }> = {
  bundleId,
  fileName: 'cherry-studio-diagnostics.zip',
  reason: 'service_unavailable',
  status: 'submission_failed'
}

const submissionUnknownResult: Extract<OutputFor<'diagnostics.bundle.upload'>, { status: 'submission_unknown' }> = {
  bundleId,
  fileName: 'cherry-studio-diagnostics.zip',
  status: 'submission_unknown'
}

const busyResult: Extract<OutputFor<'diagnostics.bundle.upload'>, { status: 'busy' }> = { status: 'busy' }

const savedUploadResult: Extract<OutputFor<'diagnostics.bundle.save_upload'>, { status: 'saved' }> = {
  bundleId,
  fileName: 'saved-diagnostics.zip',
  filePath: fallbackPath,
  status: 'saved'
}

async function completeReview(user: ReturnType<typeof userEvent.setup>, description = '  App freezes on launch.  ') {
  await user.type(screen.getByRole('textbox', { name: 'Problem description' }), description)
  await user.click(
    screen.getByRole('checkbox', {
      name: 'I understand that the problem description and selected diagnostic data may contain sensitive information, and agree to send this content to Cherry Studio for troubleshooting.'
    })
  )
  await waitFor(() => expect(screen.getByRole('button', { name: 'Submit diagnostic report' })).toBeEnabled())
}

async function closeResultDialog(user: ReturnType<typeof userEvent.setup>) {
  const closeButton = (await screen.findAllByRole('button', { name: 'Delete' })).find(
    (button) => button.textContent === 'Delete'
  )
  expect(closeButton).toBeDefined()
  await user.click(closeButton!)
}

function TestDiagnosticUploadPanel({
  initialDescription = '',
  onBusyChange,
  onClose = () => undefined
}: {
  readonly initialDescription?: string
  readonly onBusyChange?: (busy: boolean) => void
  readonly onClose?: () => void
}) {
  const [description, setDescription] = useState(initialDescription)
  return (
    <DiagnosticUploadPanel
      description={description}
      onBusyChange={onBusyChange}
      onClose={onClose}
      onDescriptionChange={setDescription}
    />
  )
}

function DiagnosticUploadDialog({
  initialDescription,
  onOpenChange,
  open
}: {
  readonly initialDescription?: string
  readonly onOpenChange: (open: boolean) => void
  readonly open: boolean
}) {
  if (!open) return null
  return <TestDiagnosticUploadPanel initialDescription={initialDescription} onClose={() => onOpenChange(false)} />
}

describe('DiagnosticUploadPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') return inspectResult
      if (route === 'diagnostics.bundle.upload') return uploadedResult
      return undefined
    })
  })

  it('renders the controlled problem-report form without creating another dialog', async () => {
    const onDescriptionChange = vi.fn()
    const user = userEvent.setup()
    render(
      <DiagnosticUploadPanel description="Reviewed issue" onDescriptionChange={onDescriptionChange} onClose={vi.fn()} />
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const description = screen.getByRole('textbox', { name: 'Problem description' })
    expect(description).toHaveValue('Reviewed issue')
    await user.type(description, '!')
    expect(onDescriptionChange).toHaveBeenLastCalledWith('Reviewed issue!')
  })

  it('validates an empty description on submit and keeps the error current while editing', async () => {
    const user = userEvent.setup()
    render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)

    const submit = screen.getByRole('button', { name: 'Submit diagnostic report' })
    const description = screen.getByRole('textbox', { name: 'Problem description' })
    const acknowledgement = screen.getByRole('checkbox', {
      name: 'I understand that the problem description and selected diagnostic data may contain sensitive information, and agree to send this content to Cherry Studio for troubleshooting.'
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
        name: 'I understand that the problem description and selected diagnostic data may contain sensitive information, and agree to send this content to Cherry Studio for troubleshooting.'
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

    const description = screen.getByRole('textbox', { name: 'Problem description' })
    const acknowledgement = screen.getByRole('checkbox', {
      name: 'I understand that the problem description and selected diagnostic data may contain sensitive information, and agree to send this content to Cherry Studio for troubleshooting.'
    })
    const submit = screen.getByRole('button', { name: 'Submit diagnostic report' })
    await user.type(description, '  App freezes on launch.  ')
    await waitFor(() => expect(screen.queryByText('Inspecting diagnostic data…')).not.toBeInTheDocument())
    expect(submit).toBeDisabled()
    await user.click(acknowledgement)
    await waitFor(() => expect(submit).toBeEnabled())

    await user.type(description, ' Please investigate. ')
    expect(acknowledgement).toBeChecked()
    await user.click(submit)

    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.upload', {
        description: 'App freezes on launch.   Please investigate.',
        includeChatRecords: false,
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
      name: 'I understand that the problem description and selected diagnostic data may contain sensitive information, and agree to send this content to Cherry Studio for troubleshooting.'
    })
    await user.click(screen.getByRole('radio', { name: 'Last 3 days' }))
    expect(acknowledgement).not.toBeChecked()

    await user.click(acknowledgement)
    await user.click(screen.getByRole('switch', { name: 'App logs' }))
    expect(acknowledgement).not.toBeChecked()

    await user.click(acknowledgement)
    await user.click(screen.getByRole('switch', { name: 'Detailed activity records' }))
    expect(acknowledgement).not.toBeChecked()

    await user.click(acknowledgement)
    await user.click(screen.getByRole('switch', { name: 'Chat history' }))
    expect(acknowledgement).not.toBeChecked()
  })

  it('submits chat history only after the user explicitly enables it', async () => {
    const user = userEvent.setup()
    render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)

    const chatRecords = await screen.findByRole('switch', { name: 'Chat history' })
    expect(chatRecords).not.toBeChecked()
    await user.click(chatRecords)
    await completeReview(user)
    await user.click(screen.getByRole('button', { name: 'Submit diagnostic report' }))

    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.upload', {
        description: 'App freezes on launch.',
        includeChatRecords: true,
        includeLogs: true,
        includeTraces: true,
        range: '24h'
      })
    )
  })

  it('excludes selected chat history when it is unavailable for the new range', async () => {
    mocks.request.mockImplementation(async (route: string, input?: { range?: string }) => {
      if (route === 'diagnostics.bundle.inspect') {
        if (input?.range === '3d') {
          return {
            ...inspectResult,
            sources: {
              ...inspectResult.sources,
              chatRecords: { available: false, estimatedBytes: 0, messageCount: 0 }
            }
          }
        }
        return inspectResult
      }
      if (route === 'diagnostics.bundle.upload') return uploadedResult
      return undefined
    })
    const user = userEvent.setup()
    render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)

    const chatRecords = await screen.findByRole('switch', { name: 'Chat history' })
    await user.click(chatRecords)
    await user.click(screen.getByRole('radio', { name: 'Last 3 days' }))
    await waitFor(() => expect(chatRecords).toBeDisabled())
    await completeReview(user)
    await user.click(screen.getByRole('button', { name: 'Submit diagnostic report' }))

    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.upload', {
        description: 'App freezes on launch.',
        includeChatRecords: false,
        includeLogs: true,
        includeTraces: true,
        range: '3d'
      })
    )
  })

  it('keeps range inspection feedback out of the dialog layout', async () => {
    let resolveRangeInspection: (result: typeof inspectResult) => void = () => undefined
    mocks.request.mockImplementation((route: string, input?: { range?: string }) => {
      if (route === 'diagnostics.bundle.inspect' && input?.range === '3d') {
        return new Promise((resolve) => {
          resolveRangeInspection = resolve
        })
      }
      if (route === 'diagnostics.bundle.inspect') return Promise.resolve(inspectResult)
      if (route === 'diagnostics.bundle.upload') return Promise.resolve(uploadedResult)
      return Promise.resolve(undefined)
    })
    const user = userEvent.setup()
    render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)

    await screen.findByRole('switch', { name: 'Chat history' })
    const inspectionStatus = screen.getByRole('status')
    // The live announcement must not add a normal-flow row that shifts the panel layout.
    expect(inspectionStatus).toHaveClass('sr-only')
    expect(inspectionStatus).toBeEmptyDOMElement()

    await user.click(screen.getByRole('radio', { name: 'Last 3 days' }))

    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.inspect', { range: '3d' }))
    expect(inspectionStatus).toHaveTextContent('Inspecting diagnostic data…')

    resolveRangeInspection(inspectResult)
    await waitFor(() => expect(inspectionStatus).toBeEmptyDOMElement())
  })

  it('exposes no dismiss action while submitting and shows only the API feedback ID on success', async () => {
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
    const onBusyChange = vi.fn()
    const user = userEvent.setup()
    const clipboardWrite = vi.spyOn(navigator.clipboard, 'writeText')
    render(<TestDiagnosticUploadPanel onBusyChange={onBusyChange} />)
    await completeReview(user)

    await user.click(screen.getByRole('button', { name: 'Submit diagnostic report' }))

    expect(screen.getByRole('button', { name: 'Submitting diagnostic report…' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    expect(onBusyChange).toHaveBeenLastCalledWith(true)

    resolveUpload(uploadedResult)
    expect(await screen.findByText('Diagnostic report submitted')).toBeInTheDocument()
    expect(screen.getByText('Feedback ID')).toBeInTheDocument()
    expect(screen.getByText(reportId)).toBeInTheDocument()
    expect(screen.queryByText(bundleId)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copy feedback ID' }))
    expect(clipboardWrite).toHaveBeenCalledWith(reportId)
    expect(mocks.toastSuccess).toHaveBeenCalledWith('message.copy.success')
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
    expect(
      screen.getByText(
        'The diagnostic report service is temporarily unavailable. Try again later or use manual feedback.'
      )
    ).toBeInTheDocument()
    expect(mocks.request).not.toHaveBeenCalledWith('system.shell.open_website', DIAGNOSTIC_FEEDBACK_FORM_URL)

    expect(screen.queryByRole('region', { name: 'Saved locally' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save locally' })).toBeInTheDocument()
    const manualFeedback = screen.getByRole('button', { name: 'Manual feedback' })
    const retry = screen.getByRole('button', { name: 'Retry' })
    expect(manualFeedback.compareDocumentPosition(retry)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    await user.click(manualFeedback)
    expect(mocks.request).toHaveBeenCalledWith('system.shell.open_website', DIAGNOSTIC_FEEDBACK_FORM_URL)
    await user.click(retry)
    expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.retry_upload', { bundleId })
    expect(await screen.findByText(reportId)).toBeInTheDocument()
  })

  it('reports a busy upload without replacing the editable submission form', async () => {
    let uploadAttempts = 0
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') return inspectResult
      if (route === 'diagnostics.bundle.upload') return uploadAttempts++ === 0 ? busyResult : uploadedResult
      return undefined
    })
    const user = userEvent.setup()
    render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)
    await completeReview(user)
    await user.click(screen.getByRole('button', { name: 'Submit diagnostic report' }))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('Another diagnostic bundle operation is already in progress')
    )
    const description = screen.getByRole('textbox', { name: 'Problem description' })
    expect(description).toHaveValue('  App freezes on launch.  ')
    expect(screen.getByRole('button', { name: 'Submit diagnostic report' })).toBeEnabled()

    await user.clear(description)
    await user.type(description, 'The app freezes after reopening.')
    await user.click(screen.getByRole('button', { name: 'Submit diagnostic report' }))

    expect(await screen.findByText(reportId)).toBeInTheDocument()
    expect(mocks.request.mock.calls.filter(([route]) => route === 'diagnostics.bundle.upload')).toHaveLength(2)
    expect(mocks.request).toHaveBeenLastCalledWith('diagnostics.bundle.upload', {
      description: 'The app freezes after reopening.',
      includeChatRecords: false,
      includeLogs: true,
      includeTraces: true,
      range: '24h'
    })
  })

  it('saves a retained upload on demand and then exposes its selected filename and location', async () => {
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') return inspectResult
      if (route === 'diagnostics.bundle.upload') return submissionFailedResult
      if (route === 'diagnostics.bundle.save_upload') return savedUploadResult
      return undefined
    })
    const user = userEvent.setup()
    render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)
    await completeReview(user)
    await user.click(screen.getByRole('button', { name: 'Submit diagnostic report' }))

    await user.click(await screen.findByRole('button', { name: 'Save locally' }))

    expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.save_upload', { bundleId })
    const savedBundle = await screen.findByRole('region', { name: 'Saved locally' })
    expect(within(savedBundle).getByText('saved-diagnostics.zip')).toBeInTheDocument()
    expect(within(savedBundle).getByText('Saved locally')).toBeInTheDocument()
    await user.click(within(savedBundle).getByRole('button', { name: 'Open location' }))
    expect(mocks.request).toHaveBeenCalledWith('file.show_in_folder', { kind: 'path', path: fallbackPath })
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save locally' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('treats an already discarded retained upload as a successful close', async () => {
    let resolveDiscard: (result: OutputFor<'diagnostics.bundle.discard_upload'>) => void = () => undefined
    mocks.request.mockImplementation((route: string) => {
      if (route === 'diagnostics.bundle.inspect') return Promise.resolve(inspectResult)
      if (route === 'diagnostics.bundle.upload') return Promise.resolve(submissionFailedResult)
      if (route === 'diagnostics.bundle.discard_upload') {
        return new Promise<OutputFor<'diagnostics.bundle.discard_upload'>>((resolve) => {
          resolveDiscard = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<TestDiagnosticUploadPanel onClose={onClose} />)
    await completeReview(user)
    await user.click(screen.getByRole('button', { name: 'Submit diagnostic report' }))

    await closeResultDialog(user)

    expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.discard_upload', { bundleId })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Loading...' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save locally' })).not.toBeInTheDocument()
    resolveDiscard({ status: 'not_found' })
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('discards a retained upload when its owning dialog unmounts', async () => {
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') return inspectResult
      if (route === 'diagnostics.bundle.upload') return submissionFailedResult
      if (route === 'diagnostics.bundle.discard_upload') return { status: 'discarded' }
      return undefined
    })
    const user = userEvent.setup()
    const { unmount } = render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)
    await completeReview(user)
    await user.click(screen.getByRole('button', { name: 'Submit diagnostic report' }))
    expect(await screen.findByText('Diagnostic report was not submitted')).toBeInTheDocument()

    unmount()

    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.discard_upload', { bundleId }))
  })

  it('discards a retained upload that finishes after its owning dialog unmounts', async () => {
    let resolveUpload: (result: typeof submissionUnknownResult) => void = () => undefined
    mocks.request.mockImplementation((route: string) => {
      if (route === 'diagnostics.bundle.inspect') return Promise.resolve(inspectResult)
      if (route === 'diagnostics.bundle.upload') {
        return new Promise((resolve) => {
          resolveUpload = resolve
        })
      }
      if (route === 'diagnostics.bundle.discard_upload') return Promise.resolve({ status: 'discarded' })
      return Promise.resolve(undefined)
    })
    const onBusyChange = vi.fn()
    const user = userEvent.setup()
    const { unmount } = render(<TestDiagnosticUploadPanel onBusyChange={onBusyChange} />)
    await completeReview(user)
    await user.click(screen.getByRole('button', { name: 'Submit diagnostic report' }))
    await waitFor(() =>
      expect(mocks.request.mock.calls.some(([route]) => route === 'diagnostics.bundle.upload')).toBe(true)
    )
    expect(onBusyChange).toHaveBeenLastCalledWith(true)

    unmount()
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
    await act(async () => resolveUpload(submissionUnknownResult))

    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.discard_upload', { bundleId }))
  })

  it('keeps a retained upload accessible when discard is busy', async () => {
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') return inspectResult
      if (route === 'diagnostics.bundle.upload') return submissionFailedResult
      if (route === 'diagnostics.bundle.discard_upload') return { status: 'busy' }
      return undefined
    })
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(<DiagnosticUploadDialog open onOpenChange={onOpenChange} />)
    await completeReview(user)
    await user.click(screen.getByRole('button', { name: 'Submit diagnostic report' }))

    await closeResultDialog(user)

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('Another diagnostic bundle operation is already in progress')
    )
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('keeps a retained upload accessible and reports a discard failure', async () => {
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') return inspectResult
      if (route === 'diagnostics.bundle.upload') return submissionFailedResult
      if (route === 'diagnostics.bundle.discard_upload') throw new Error('discard failed')
      return undefined
    })
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(<DiagnosticUploadDialog open onOpenChange={onOpenChange} />)
    await completeReview(user)
    await user.click(screen.getByRole('button', { name: 'Submit diagnostic report' }))

    await closeResultDialog(user)

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Could not close the problem report. Try again.'))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('retries an unknown submission directly and keeps retry locked', async () => {
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
    expect(
      screen.getByText(
        'Could not confirm whether this submission succeeded. Save the diagnostic file locally, then contact the Cherry Studio support team or upload it through the Feishu form via Manual feedback. Retrying may submit the same diagnostic report again.'
      )
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.retry_upload', { bundleId })
    expect(screen.queryByRole('dialog', { name: 'Retry diagnostic report?' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submitting diagnostic report…' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()

    resolveRetry(uploadedResult)
    expect(await screen.findByText(reportId)).toBeInTheDocument()
  })

  it('keeps retry available when manually saving a retained upload fails', async () => {
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') return inspectResult
      if (route === 'diagnostics.bundle.upload') return submissionFailedResult
      if (route === 'diagnostics.bundle.save_upload') throw new IpcError(diagnosticsErrorCodes.FALLBACK_SAVE_FAILED)
      return undefined
    })
    const user = userEvent.setup()
    render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)
    await completeReview(user)
    await user.click(screen.getByRole('button', { name: 'Submit diagnostic report' }))
    await user.click(await screen.findByRole('button', { name: 'Save locally' }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Could not save the diagnostic report'))
    expect(screen.getByRole('button', { name: 'Save locally' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByText('Diagnostic report submitted')).not.toBeInTheDocument()
  })
})
