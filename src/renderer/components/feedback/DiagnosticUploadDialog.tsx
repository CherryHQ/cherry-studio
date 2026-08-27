import {
  Alert,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Scrollbar,
  SegmentedControl,
  Switch,
  Textarea
} from '@cherrystudio/ui'
import CopyButton from '@renderer/components/CopyButton'
import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import { diagnosticsErrorCodes } from '@shared/ipc/errors/diagnostics'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { DiagnosticRange, DiagnosticUploadFailureReason } from '@shared/ipc/schemas/diagnostics'
import type { OutputFor } from '@shared/ipc/types'
import {
  DIAGNOSTIC_DESCRIPTION_MAX_BYTES,
  DIAGNOSTIC_FEEDBACK_FORM_URL,
  diagnosticDescriptionByteLength
} from '@shared/utils/diagnostics'
import { createFilePathHandle } from '@shared/utils/file'
import { LoaderCircle } from 'lucide-react'
import type { FormEvent } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('DiagnosticUploadDialog')
const RANGE_OPTIONS = [
  { translationKey: 'settings.about.diagnostics.ranges.24h', value: '24h' },
  { translationKey: 'settings.about.diagnostics.ranges.3d', value: '3d' },
  { translationKey: 'settings.about.diagnostics.ranges.7d', value: '7d' }
] as const

type InspectResult = OutputFor<'diagnostics.bundle.inspect'>
type UploadResult = Exclude<OutputFor<'diagnostics.bundle.upload'>, { status: 'busy' }>
type SubmissionStatus = 'idle' | 'submitting' | 'submission_unknown_fallback_save_failed'

interface DiagnosticUploadDialogProps {
  readonly onOpenChange: (open: boolean) => void
  readonly open: boolean
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** unitIndex
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

export function DiagnosticUploadDialog({ onOpenChange, open }: DiagnosticUploadDialogProps) {
  const { t } = useTranslation()
  const uploadFormId = useId()
  const [range, setRange] = useState<DiagnosticRange>('24h')
  const [includeLogs, setIncludeLogs] = useState(true)
  const [includeTraces, setIncludeTraces] = useState(true)
  const [description, setDescription] = useState('')
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [inspectResult, setInspectResult] = useState<InspectResult | null>(null)
  const [inspectError, setInspectError] = useState(false)
  const [isInspecting, setIsInspecting] = useState(false)
  const [submissionStatus, setSubmissionStatus] = useState<SubmissionStatus>('idle')
  const [result, setResult] = useState<UploadResult | null>(null)
  const [retryConfirmationOpen, setRetryConfirmationOpen] = useState(false)
  const primaryActionRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    let active = true
    setIsInspecting(true)
    setInspectError(false)
    void ipcApi
      .request('diagnostics.bundle.inspect', { range })
      .then((inspection) => {
        if (active) setInspectResult(inspection)
      })
      .catch((error) => {
        if (!active) return
        logger.error('Failed to inspect diagnostic upload sources', error as Error)
        setInspectResult(null)
        setInspectError(true)
      })
      .finally(() => {
        if (active) setIsInspecting(false)
      })
    return () => {
      active = false
    }
  }, [open, range])

  useEffect(() => {
    if (result || submissionStatus === 'submission_unknown_fallback_save_failed') primaryActionRef.current?.focus()
  }, [result, submissionStatus])

  useEffect(() => {
    if (!open) setHasAttemptedSubmit(false)
  }, [open])

  const logsAvailable = inspectResult?.sources.logs.available ?? false
  const tracesAvailable = inspectResult?.sources.traces.available ?? false
  const effectiveIncludeLogs = includeLogs && logsAvailable
  const effectiveIncludeTraces = includeTraces && tracesAvailable
  const isInspectionPending = open && !inspectError && (isInspecting || inspectResult === null)
  const normalizedDescription = description.trim()
  const descriptionValid =
    normalizedDescription.length > 0 &&
    diagnosticDescriptionByteLength(normalizedDescription) <= DIAGNOSTIC_DESCRIPTION_MAX_BYTES
  const showDescriptionError = hasAttemptedSubmit && !descriptionValid
  const isSubmitting = submissionStatus === 'submitting'
  const canAttemptUpload =
    inspectResult !== null && !isInspectionPending && !inspectError && submissionStatus === 'idle' && acknowledged

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isSubmitting) return
    onOpenChange(nextOpen)
  }

  const openManualForm = async () => {
    try {
      await ipcApi.request('system.shell.open_website', DIAGNOSTIC_FEEDBACK_FORM_URL)
    } catch (error) {
      logger.error('Failed to open the diagnostic feedback form', error as Error)
      toast.error(t('settings.about.diagnostics.upload.errors.open_form_failed'))
    }
  }

  const revealBundle = async () => {
    if (!result || result.status === 'uploaded') return
    try {
      await ipcApi.request('file.show_in_folder', createFilePathHandle(result.filePath))
    } catch (error) {
      logger.error('Failed to reveal diagnostic upload fallback', error as Error)
      toast.error(t('settings.about.diagnostics.errors.reveal_failed'))
    }
  }

  const acceptSubmissionResult = (uploadResult: OutputFor<'diagnostics.bundle.upload'>) => {
    if (uploadResult.status === 'busy') {
      toast.error(t('settings.about.diagnostics.errors.busy'))
      return
    }
    setResult(uploadResult)
  }

  const uploadBundle = async () => {
    if (!canAttemptUpload || !descriptionValid) return
    setSubmissionStatus('submitting')
    try {
      const uploadResult = await ipcApi.request('diagnostics.bundle.upload', {
        description: normalizedDescription,
        includeLogs: effectiveIncludeLogs,
        includeTraces: effectiveIncludeTraces,
        range
      })
      acceptSubmissionResult(uploadResult)
      setSubmissionStatus('idle')
    } catch (error) {
      logger.error('Failed to upload diagnostic bundle', error as Error)
      if (error instanceof IpcError && error.code === diagnosticsErrorCodes.SUBMISSION_UNKNOWN_FALLBACK_SAVE_FAILED) {
        setSubmissionStatus('submission_unknown_fallback_save_failed')
        return
      }
      setSubmissionStatus('idle')
      toast.error(t('settings.about.diagnostics.upload.errors.upload_failed'))
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setHasAttemptedSubmit(true)
    if (!descriptionValid || !canAttemptUpload) return
    void uploadBundle()
  }

  const retryUpload = async () => {
    if (!result || result.status === 'uploaded' || isSubmitting) return
    setSubmissionStatus('submitting')
    try {
      const retryResult = await ipcApi.request('diagnostics.bundle.retry_upload', { bundleId: result.bundleId })
      acceptSubmissionResult(retryResult)
    } catch (error) {
      logger.error('Failed to retry diagnostic upload', error as Error)
      toast.error(t('settings.about.diagnostics.upload.errors.upload_failed'))
    } finally {
      setSubmissionStatus('idle')
    }
  }

  const rangeOptions = RANGE_OPTIONS.map(({ translationKey, value }) => ({
    label: t(translationKey),
    value
  }))

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          size="xl"
          className="grid max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0"
          closeOnOverlayClick={!isSubmitting}
          showCloseButton={!isSubmitting}
          onEscapeKeyDown={(event) => {
            if (isSubmitting) event.preventDefault()
          }}>
          <DialogHeader className="px-6 pt-6 pr-12 pb-4">
            <DialogTitle>{t('settings.about.diagnostics.upload.dialog.title')}</DialogTitle>
            <DialogDescription>{t('settings.about.diagnostics.upload.dialog.description')}</DialogDescription>
          </DialogHeader>

          <Scrollbar className="min-h-0 px-6 py-2">
            {result ? (
              <UploadResultContent result={result} />
            ) : submissionStatus === 'submission_unknown_fallback_save_failed' ? (
              <SubmissionUnknownFallbackSaveFailedContent />
            ) : (
              <form id={uploadFormId} className="space-y-4" onSubmit={handleSubmit}>
                <section className="space-y-2">
                  <label htmlFor="diagnostic-description" className="font-medium text-sm">
                    {t('settings.about.diagnostics.report.description_label')}
                  </label>
                  <Textarea.Input
                    id="diagnostic-description"
                    value={description}
                    onValueChange={setDescription}
                    placeholder={t('settings.about.diagnostics.report.description_placeholder')}
                    rows={4}
                    disabled={isSubmitting}
                    hasError={showDescriptionError}
                    aria-describedby={showDescriptionError ? 'diagnostic-description-error' : undefined}
                  />
                  {showDescriptionError ? (
                    <p id="diagnostic-description-error" className="text-error text-xs">
                      {t(
                        normalizedDescription.length === 0
                          ? 'settings.about.diagnostics.report.description_required'
                          : 'settings.about.diagnostics.report.description_too_long'
                      )}
                    </p>
                  ) : null}
                </section>

                <section className="space-y-2">
                  <p className="font-medium text-sm">{t('settings.about.diagnostics.range_title')}</p>
                  <SegmentedControl<DiagnosticRange>
                    value={range}
                    onValueChange={(nextRange) => {
                      setRange(nextRange)
                      setInspectResult(null)
                      setAcknowledged(false)
                    }}
                    options={rangeOptions}
                    disabled={isSubmitting}
                  />
                </section>

                <section className="divide-y divide-border rounded-xl border border-border">
                  <SourceRow
                    title={t('settings.about.diagnostics.sources.system.title')}
                    description={t('settings.about.diagnostics.sources.system.description', {
                      crashCount: inspectResult?.sources.crashDumps.fileCount ?? 0
                    })}
                    checked
                    disabled
                  />
                  <SourceRow
                    title={t('settings.about.diagnostics.sources.logs.title')}
                    description={sourceDescription(t, inspectResult?.sources.logs, isInspectionPending)}
                    checked={effectiveIncludeLogs}
                    disabled={isSubmitting || isInspectionPending || !logsAvailable}
                    onCheckedChange={(checked) => {
                      setIncludeLogs(checked)
                      setAcknowledged(false)
                    }}
                  />
                  <SourceRow
                    title={t('settings.about.diagnostics.sources.traces.title')}
                    description={sourceDescription(t, inspectResult?.sources.traces, isInspectionPending)}
                    checked={effectiveIncludeTraces}
                    disabled={isSubmitting || isInspectionPending || !tracesAvailable}
                    onCheckedChange={(checked) => {
                      setIncludeTraces(checked)
                      setAcknowledged(false)
                    }}
                  />
                </section>

                {isInspectionPending ? (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm" role="status">
                    <LoaderCircle className="size-4 animate-spin" />
                    {t('settings.about.diagnostics.inspecting')}
                  </div>
                ) : null}
                {inspectError ? (
                  <p className="text-error text-sm" role="alert">
                    {t('settings.about.diagnostics.errors.inspect_failed')}
                  </p>
                ) : null}
                {inspectResult?.hasWarnings ? (
                  <Alert type="warning" showIcon description={t('settings.about.diagnostics.warning')} />
                ) : null}
                <Alert
                  type="info"
                  showIcon
                  message={t('settings.about.diagnostics.upload.privacy.title')}
                  description={t('settings.about.diagnostics.upload.privacy.description', {
                    size: formatBytes(inspectResult?.sourceLimitBytes ?? 50 * 1024 * 1024)
                  })}
                />
                <label className="flex cursor-pointer items-start gap-3 text-sm" htmlFor="diagnostic-acknowledgement">
                  <Checkbox
                    id="diagnostic-acknowledgement"
                    checked={acknowledged}
                    disabled={isSubmitting}
                    onCheckedChange={(checked) => setAcknowledged(checked === true)}
                  />
                  <span>{t('settings.about.diagnostics.report.acknowledgement')}</span>
                </label>
              </form>
            )}
          </Scrollbar>

          <DialogFooter className="mt-4 border-border border-t px-6 py-4">
            {isSubmitting ? (
              <Button variant="emphasis" loading disabled>
                {t('settings.about.diagnostics.report.submitting')}
              </Button>
            ) : submissionStatus === 'submission_unknown_fallback_save_failed' ? (
              <Button ref={primaryActionRef} variant="outline" onClick={() => handleOpenChange(false)}>
                {t('settings.about.diagnostics.actions.close')}
              </Button>
            ) : result ? (
              <>
                <Button
                  ref={result.status === 'uploaded' ? primaryActionRef : undefined}
                  variant="outline"
                  onClick={() => handleOpenChange(false)}>
                  {t('settings.about.diagnostics.actions.close')}
                </Button>
                {result.status !== 'uploaded' ? (
                  <Button variant="outline" onClick={() => void revealBundle()}>
                    {t('settings.about.diagnostics.actions.reveal')}
                  </Button>
                ) : null}
                {result.status === 'submission_failed' ? (
                  <Button variant="outline" onClick={() => void openManualForm()}>
                    {t('settings.about.diagnostics.report.open_manual_form')}
                  </Button>
                ) : null}
                {result.status !== 'uploaded' ? (
                  <Button
                    ref={primaryActionRef}
                    variant="emphasis"
                    onClick={() => {
                      if (result.status === 'submission_unknown') {
                        setRetryConfirmationOpen(true)
                      } else {
                        void retryUpload()
                      }
                    }}>
                    {t('settings.about.diagnostics.report.retry')}
                  </Button>
                ) : null}
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => handleOpenChange(false)}>
                  {t('settings.about.diagnostics.actions.cancel')}
                </Button>
                <Button type="submit" form={uploadFormId} variant="emphasis" disabled={!canAttemptUpload}>
                  {t('settings.about.diagnostics.upload.actions.consent_upload')}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={retryConfirmationOpen}
        onOpenChange={setRetryConfirmationOpen}
        title={t('settings.about.diagnostics.report.retry_unknown_title')}
        description={t('settings.about.diagnostics.report.retry_unknown_description')}
        cancelText={t('settings.about.diagnostics.actions.cancel')}
        confirmText={t('settings.about.diagnostics.report.retry')}
        onConfirm={() => {
          setRetryConfirmationOpen(false)
          void retryUpload()
        }}
      />
    </>
  )
}

function SubmissionUnknownFallbackSaveFailedContent() {
  const { t } = useTranslation()
  return (
    <Alert
      type="warning"
      showIcon
      message={t('settings.about.diagnostics.upload.unknown_without_copy.title')}
      description={t('settings.about.diagnostics.upload.unknown_without_copy.description')}
    />
  )
}

function UploadResultContent({ result }: { readonly result: UploadResult }) {
  const { t } = useTranslation()
  if (result.status === 'uploaded') {
    return (
      <Alert type="success" showIcon role="status" aria-live="polite" aria-atomic="true">
        <div className="space-y-2">
          <p className="font-medium">{t('settings.about.diagnostics.report.success_title')}</p>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t('settings.about.diagnostics.report.feedback_id')}</span>
            <code className="break-all">{result.reportId}</code>
            <CopyButton
              textToCopy={result.reportId}
              aria-label={t('settings.about.diagnostics.report.copy_id')}
              successFeedback="icon"
            />
          </div>
        </div>
      </Alert>
    )
  }

  const isUnknown = result.status === 'submission_unknown'
  return (
    <div className="space-y-4">
      <Alert
        type="warning"
        showIcon
        message={t(
          isUnknown
            ? 'settings.about.diagnostics.upload.unknown.title'
            : 'settings.about.diagnostics.upload.manual.title'
        )}
        description={
          isUnknown ? t('settings.about.diagnostics.upload.unknown.description') : failureReasonText(t, result.reason)
        }
      />
      <p className="break-all text-xs">{result.fileName}</p>
    </div>
  )
}

function failureReasonText(t: ReturnType<typeof useTranslation>['t'], reason: DiagnosticUploadFailureReason): string {
  const keys: Record<DiagnosticUploadFailureReason, string> = {
    archive_too_large: 'settings.about.diagnostics.report.failure_reasons.archive_too_large',
    authentication_failed: 'settings.about.diagnostics.report.failure_reasons.authentication_failed',
    invalid_archive: 'settings.about.diagnostics.report.failure_reasons.invalid_archive',
    rate_limited: 'settings.about.diagnostics.report.failure_reasons.rate_limited',
    service_unavailable: 'settings.about.diagnostics.report.failure_reasons.service_unavailable',
    submission_rejected: 'settings.about.diagnostics.report.failure_reasons.submission_rejected'
  }
  return t(keys[reason])
}

function sourceDescription(
  t: ReturnType<typeof useTranslation>['t'],
  source: InspectResult['sources']['logs'] | undefined,
  isInspectionPending: boolean
): string {
  if (isInspectionPending) return t('settings.about.diagnostics.sources.inspecting')
  if (!source?.available) return t('settings.about.diagnostics.sources.unavailable')
  return t('settings.about.diagnostics.sources.summary', {
    count: source.fileCount,
    size: formatBytes(source.estimatedBytes)
  })
}

function SourceRow({
  checked,
  description,
  disabled,
  onCheckedChange,
  title
}: {
  readonly checked: boolean
  readonly description: string
  readonly disabled: boolean
  readonly onCheckedChange?: (checked: boolean) => void
  readonly title: string
}) {
  return (
    <div className="flex items-center justify-between gap-4 p-3">
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium text-sm">{title}</p>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      <Switch aria-label={title} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  )
}

export default DiagnosticUploadDialog
