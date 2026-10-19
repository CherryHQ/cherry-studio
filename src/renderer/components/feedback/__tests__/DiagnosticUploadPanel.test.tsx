// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UpdateInfo } from 'builder-util-runtime'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DefaultUseCache } from '@shared/data/cache/cacheSchemas'
import type { CacheAppUpdateState } from '@shared/data/cache/cacheValueTypes'
import { diagnosticsErrorCodes } from '@shared/ipc/errors/diagnostics'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { OutputFor } from '@shared/ipc/types'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { DIAGNOSTIC_FEEDBACK_FORM_URL } from '@shared/utils/diagnostics'

import enUs from '../../../i18n/locales/en-us.json'

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  request: vi.fn(),
  showUpdateDialog: vi.fn(),
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
      'Upload logs for troubleshooting only. They may contain chat history, device information, and other data.',
    'settings.about.diagnostics.report.copy_id': 'Copy feedback ID',
    'settings.about.diagnostics.report.copy_url': 'Copy status link',
    'settings.about.diagnostics.report.description_label': 'Problem description',
    'settings.about.diagnostics.report.description_required': 'A problem description is required',
    'settings.about.diagnostics.report.description_too_long': 'The problem description is too long',
    'settings.about.diagnostics.report.failure_reasons.service_unavailable':
      'The diagnostic report service is temporarily unavailable. Try again later or use manual feedback.',
    'settings.about.diagnostics.report.feedback_id': 'Feedback ID',
    'settings.about.diagnostics.report.processing_status': 'Processing status',
    'settings.about.diagnostics.report.open_location': 'Open location',
    'settings.about.diagnostics.report.open_manual_form': 'Manual feedback',
    'settings.about.diagnostics.report.retry': 'Retry',
    'settings.about.diagnostics.report.save_locally': 'Save locally',
    'settings.about.diagnostics.report.saving': 'Saving diagnostic report…',
    'settings.about.diagnostics.report.status_url': 'Status link',
    'settings.about.diagnostics.report.submitting': 'Submitting diagnostic report…',
    'settings.about.diagnostics.report.success_title': 'Diagnostic report submitted',
    'settings.about.diagnostics.report.update_hint':
      'You can check for a newer Cherry Studio version and install it here.',
    'settings.about.checkUpdate.available': 'Update',
    'settings.about.checkUpdate.label': 'Check Update',
    'settings.about.downloading': 'Downloading...',
    'settings.about.updateError': 'Update error',
    'settings.about.diagnostics.status.pending': 'Pending',
    'settings.about.feedback.history.open': 'Open status page',
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

vi.mock('@renderer/components/UpdateDialogPopup', () => ({
  default: { show: (...args: unknown[]) => mocks.showUpdateDialog(...args) }
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

const bundleId = '9de71f3c-f4cf-4311-a3f3-86f12a930451'
const reportId = 'opaque-report-id'
const fallbackPath = AbsoluteFilePathSchema.parse('/tmp/cherry-studio-diagnostics.zip')

const uploadedResult: Extract<OutputFor<'diagnostics.bundle.upload'>, { status: 'uploaded' }> = {
  reportId,
  reportUrl: `https://api.cherry-ai.com/diagnostics/${reportId}`,
  processingStatus: 'pending',
  historySaved: true,
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

const updateHint = 'You can check for a newer Cherry Studio version and install it here.'
const downloadedRelease = {
  files: [],
  path: 'Cherry-Studio-9.9.9.dmg',
  releaseDate: '2026-10-01T00:00:00.000Z',
  releaseNotes: 'Notes',
  sha512: 'abc',
  version: '9.9.9'
} satisfies UpdateInfo

function setUpdateState(patch: Partial<CacheAppUpdateState> = {}) {
  MockUseCacheUtils.setCacheValue('app.dist.update_state', {
    ...DefaultUseCache['app.dist.update_state'],
    ...patch
  })
}

function nonPortableAppInfo() {
  return { isPortable: false, version: '2.0.0' }
}

describe('DiagnosticUploadPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setUpdateState()
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.upload') return uploadedResult
      if (route === 'app.get_info') return nonPortableAppInfo()
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
      name: 'Upload logs for troubleshooting only. They may contain chat history, device information, and other data.'
    })

    expect(acknowledgement).toBeChecked()
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

    expect(screen.queryByText('The problem description is too long')).not.toBeInTheDocument()
    await waitFor(() => expect(submit).toBeEnabled())
    await user.click(submit)

    expect(screen.getByText('The problem description is too long')).toBeInTheDocument()
    expect(mocks.request.mock.calls.filter(([route]) => route === 'diagnostics.bundle.upload')).toHaveLength(0)
  })

  it('defaults to uploading all sources for the last 24 hours and blocks submission when unchecked', async () => {
    const user = userEvent.setup()
    render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)

    const description = screen.getByRole('textbox', { name: 'Problem description' })
    const acknowledgement = screen.getByRole('checkbox', {
      name: 'Upload logs for troubleshooting only. They may contain chat history, device information, and other data.'
    })
    const submit = screen.getByRole('button', { name: 'Submit diagnostic report' })
    expect(acknowledgement).toBeChecked()
    expect(submit).toBeEnabled()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByText('Time range')).not.toBeInTheDocument()
    await user.type(description, '  App freezes on launch.  ')
    await user.click(acknowledgement)
    expect(acknowledgement).not.toBeChecked()
    expect(submit).toBeDisabled()
    await user.click(acknowledgement)
    await waitFor(() => expect(submit).toBeEnabled())

    await user.type(description, ' Please investigate. ')
    expect(acknowledgement).toBeChecked()
    await user.click(submit)

    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.upload', {
        description: 'App freezes on launch.   Please investigate.',
        includeChatRecords: true,
        includeLogs: true,
        includeTraces: true,
        range: '24h'
      })
    )
  })

  it('exposes no dismiss action while submitting and shows the report status details on success', async () => {
    let resolveUpload: (result: typeof uploadedResult) => void = () => undefined
    mocks.request.mockImplementation((route: string) => {
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
    expect(screen.getByText('Status link')).toBeInTheDocument()
    expect(screen.getByText(uploadedResult.reportUrl)).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open status page' })).toBeInTheDocument()
    expect(screen.queryByText(bundleId)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copy feedback ID' }))
    expect(clipboardWrite).toHaveBeenCalledWith(reportId)
    expect(mocks.toastSuccess).toHaveBeenCalledWith('message.copy.success')
  })

  it('offers explicit recovery actions for a rejected submission without opening the manual form automatically', async () => {
    mocks.request.mockImplementation(async (route: string) => {
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
    expect(mocks.request).not.toHaveBeenCalledWith('system.shell.open_external_website', DIAGNOSTIC_FEEDBACK_FORM_URL)

    expect(screen.queryByRole('region', { name: 'Saved locally' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save locally' })).toBeInTheDocument()
    const manualFeedback = screen.getByRole('button', { name: 'Manual feedback' })
    const retry = screen.getByRole('button', { name: 'Retry' })
    expect(manualFeedback.compareDocumentPosition(retry)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    await user.click(manualFeedback)
    expect(mocks.request).toHaveBeenCalledWith('system.shell.open_external_website', DIAGNOSTIC_FEEDBACK_FORM_URL)
    await user.click(retry)
    expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.retry_upload', { bundleId })
    expect(await screen.findByText(reportId)).toBeInTheDocument()
  })

  it('reports a busy upload without replacing the editable submission form', async () => {
    let uploadAttempts = 0
    mocks.request.mockImplementation(async (route: string) => {
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
      includeChatRecords: true,
      includeLogs: true,
      includeTraces: true,
      range: '24h'
    })
  })

  it('saves a retained upload on demand and then exposes its selected filename and location', async () => {
    mocks.request.mockImplementation(async (route: string) => {
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

  it('offers an in-app version check after a successful upload and does not describe it as a fix', async () => {
    const user = userEvent.setup()
    render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)
    await completeReview(user)

    expect(screen.queryByText(updateHint)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check Update' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Submit diagnostic report' }))

    expect(await screen.findByText(updateHint)).toBeInTheDocument()
    expect(enUs['settings.about.diagnostics.report.update_hint']).toBe(updateHint)
    const checkUpdate = screen.getByRole('button', { name: 'Check Update' })
    expect(checkUpdate).toBeEnabled()
    await user.click(checkUpdate)

    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('app.updater.check_for_update'))
    expect(mocks.request.mock.calls.filter(([route]) => route === 'app.updater.check_for_update')).toHaveLength(1)
    expect(mocks.request).not.toHaveBeenCalledWith('app.updater.quit_and_install')
    expect(mocks.showUpdateDialog).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(MockUseCacheUtils.getCacheValue('app.dist.update_state')).toMatchObject({
        checking: false,
        manualCheck: true
      })
    )
  })

  it('opens the install dialog for an already downloaded version instead of checking again', async () => {
    setUpdateState({ available: true, downloaded: true, info: downloadedRelease })
    const user = userEvent.setup()
    render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)
    await completeReview(user)
    await user.click(screen.getByRole('button', { name: 'Submit diagnostic report' }))

    const installUpdate = await screen.findByRole('button', { name: 'Update' })
    expect(installUpdate).toBeEnabled()
    expect(screen.getByText(updateHint)).toBeInTheDocument()
    await user.click(installUpdate)

    await waitFor(() => expect(mocks.showUpdateDialog).toHaveBeenCalledWith({ releaseInfo: downloadedRelease }))
    expect(mocks.request).not.toHaveBeenCalledWith('app.updater.check_for_update')
  })

  it('does not start another update check while a check or download is in progress', async () => {
    let releaseCheck: () => void = () => undefined
    mocks.request.mockImplementation((route: string) => {
      if (route === 'diagnostics.bundle.upload') return Promise.resolve(uploadedResult)
      if (route === 'app.get_info') return Promise.resolve(nonPortableAppInfo())
      if (route === 'app.updater.check_for_update') {
        return new Promise<void>((resolve) => {
          releaseCheck = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    const user = userEvent.setup()
    const { unmount } = render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)
    await completeReview(user)
    await user.click(screen.getByRole('button', { name: 'Submit diagnostic report' }))

    const checkUpdate = await screen.findByRole('button', { name: 'Check Update' })
    await user.click(checkUpdate)
    await waitFor(() =>
      expect(mocks.request.mock.calls.filter(([route]) => route === 'app.updater.check_for_update')).toHaveLength(1)
    )
    await user.click(checkUpdate)
    expect(mocks.request.mock.calls.filter(([route]) => route === 'app.updater.check_for_update')).toHaveLength(1)

    await act(async () => releaseCheck())
    unmount()

    for (const busy of [
      { checking: true, downloading: false },
      { checking: false, downloading: true, downloadProgress: 25 }
    ] as const) {
      setUpdateState(busy)
      mocks.request.mockClear()
      mocks.request.mockImplementation(async (route: string) => {
        if (route === 'diagnostics.bundle.upload') return uploadedResult
        if (route === 'app.get_info') return nonPortableAppInfo()
        return undefined
      })
      const view = render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)
      await completeReview(user)
      await user.click(screen.getByRole('button', { name: 'Submit diagnostic report' }))

      const busyUpdate = await screen.findByRole('button', {
        name: busy.downloading ? 'Downloading...' : 'Check Update'
      })
      expect(busyUpdate).toBeDisabled()
      expect(mocks.request).not.toHaveBeenCalledWith('app.updater.check_for_update')
      view.unmount()
    }
  })

  it('does not offer an app update after a failed or unknown upload', async () => {
    setUpdateState({ available: true, downloaded: true, info: downloadedRelease })
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.upload') return submissionFailedResult
      if (route === 'app.get_info') return nonPortableAppInfo()
      return undefined
    })
    const user = userEvent.setup()
    const failed = render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)
    await completeReview(user)
    await user.click(screen.getByRole('button', { name: 'Submit diagnostic report' }))

    expect(await screen.findByText('Diagnostic report was not submitted')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Manual feedback' })).toBeInTheDocument()
    expect(screen.queryByText(updateHint)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check Update' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Update' })).not.toBeInTheDocument()
    failed.unmount()

    setUpdateState({ available: true, downloaded: true, info: downloadedRelease })
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.upload') return submissionUnknownResult
      if (route === 'app.get_info') return nonPortableAppInfo()
      return undefined
    })
    render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)
    await completeReview(user)
    await user.click(screen.getByRole('button', { name: 'Submit diagnostic report' }))

    expect(await screen.findByText('Submission result is unknown')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByText(updateHint)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check Update' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Update' })).not.toBeInTheDocument()
  })

  it('does not offer an app update on a portable build', async () => {
    let resolveInfo: (info: { isPortable: boolean; version: string }) => void = () => undefined
    mocks.request.mockImplementation((route: string) => {
      if (route === 'diagnostics.bundle.upload') return Promise.resolve(uploadedResult)
      if (route === 'app.get_info') {
        return new Promise((resolve) => {
          resolveInfo = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    const user = userEvent.setup()
    render(<DiagnosticUploadDialog open onOpenChange={vi.fn()} />)
    await completeReview(user)
    await user.click(screen.getByRole('button', { name: 'Submit diagnostic report' }))

    expect(await screen.findByText('Diagnostic report submitted')).toBeInTheDocument()
    await act(async () => {
      resolveInfo({ isPortable: true, version: '2.0.0' })
    })

    expect(screen.queryByText(updateHint)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check Update' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Update' })).not.toBeInTheDocument()
    expect(mocks.request).not.toHaveBeenCalledWith('app.updater.check_for_update')
  })
})
