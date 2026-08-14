import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Scrollbar,
  SegmentedControl,
  Switch
} from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import { diagnosticsErrorCodes } from '@shared/ipc/errors/diagnostics'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { DiagnosticRange, DiagnosticUploadFallbackReason } from '@shared/ipc/schemas/diagnostics'
import type { OutputFor } from '@shared/ipc/types'
import { DIAGNOSTIC_FEEDBACK_FORM_URL } from '@shared/utils/diagnostics'
import { createFilePathHandle } from '@shared/utils/file'
import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('DiagnosticUploadDialog')
const RANGE_OPTIONS = [
  { translationKey: 'settings.about.diagnostics.ranges.24h', value: '24h' },
  { translationKey: 'settings.about.diagnostics.ranges.3d', value: '3d' },
  { translationKey: 'settings.about.diagnostics.ranges.7d', value: '7d' }
] as const

type InspectResult = OutputFor<'diagnostics.bundle.inspect'>
type UploadResult = Exclude<OutputFor<'diagnostics.bundle.upload'>, { status: 'busy' }>
type UploadState =
  | { readonly status: 'idle' }
  | { readonly status: 'uploading' }
  | { readonly status: 'submission_unknown_fallback_save_failed' }
  | { readonly result: UploadResult; readonly status: UploadResult['status'] }

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
  const [range, setRange] = useState<DiagnosticRange>('24h')
  const [includeLogs, setIncludeLogs] = useState(true)
  const [includeTraces, setIncludeTraces] = useState(true)
  const [inspectResult, setInspectResult] = useState<InspectResult | null>(null)
  const [inspectError, setInspectError] = useState(false)
  const [isInspecting, setIsInspecting] = useState(false)
  const [uploadState, setUploadState] = useState<UploadState>({ status: 'idle' })
  const primaryActionRef = useRef<HTMLButtonElement>(null)
  const status = uploadState.status
  const result = 'result' in uploadState ? uploadState.result : null
  const submissionUnknownFallbackSaveFailed = status === 'submission_unknown_fallback_save_failed'

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
    if (result || submissionUnknownFallbackSaveFailed) primaryActionRef.current?.focus()
  }, [result, submissionUnknownFallbackSaveFailed])

  const logsAvailable = inspectResult?.sources.logs.available ?? false
  const tracesAvailable = inspectResult?.sources.traces.available ?? false
  const effectiveIncludeLogs = includeLogs && logsAvailable
  const effectiveIncludeTraces = includeTraces && tracesAvailable
  const isInspectionPending = open && !inspectError && (isInspecting || inspectResult === null)
  const canUpload = inspectResult !== null && !isInspectionPending && !inspectError && status === 'idle'

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && status === 'uploading') return
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

  const uploadBundle = async () => {
    if (!canUpload) return
    setUploadState({ status: 'uploading' })
    try {
      const uploadResult = await ipcApi.request('diagnostics.bundle.upload', {
        includeLogs: effectiveIncludeLogs,
        includeTraces: effectiveIncludeTraces,
        range
      })
      if (uploadResult.status === 'busy') {
        setUploadState({ status: 'idle' })
        toast.error(t('settings.about.diagnostics.errors.busy'))
        return
      }
      setUploadState({ result: uploadResult, status: uploadResult.status })
      if (uploadResult.status === 'manual_upload_required') void openManualForm()
    } catch (error) {
      logger.error('Failed to upload diagnostic bundle', error as Error)
      if (error instanceof IpcError && error.code === diagnosticsErrorCodes.SUBMISSION_UNKNOWN_FALLBACK_SAVE_FAILED) {
        setUploadState({ status: 'submission_unknown_fallback_save_failed' })
        return
      }
      setUploadState({ status: 'idle' })
      toast.error(t('settings.about.diagnostics.upload.errors.upload_failed'))
    }
  }

  const rangeOptions = RANGE_OPTIONS.map(({ translationKey, value }) => ({
    label: t(translationKey),
    value
  }))

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        size="xl"
        className="grid max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0"
        closeOnOverlayClick={status !== 'uploading'}
        showCloseButton={status !== 'uploading'}
        onEscapeKeyDown={(event) => {
          if (status === 'uploading') event.preventDefault()
        }}>
        <DialogHeader className="px-6 pt-6 pr-12 pb-4">
          <DialogTitle>{t('settings.about.diagnostics.upload.dialog.title')}</DialogTitle>
          <DialogDescription>{t('settings.about.diagnostics.upload.dialog.description')}</DialogDescription>
        </DialogHeader>

        <Scrollbar className="min-h-0 px-6 py-2">
          {result ? (
            <UploadResultContent result={result} />
          ) : submissionUnknownFallbackSaveFailed ? (
            <SubmissionUnknownFallbackSaveFailedContent />
          ) : (
            <div className="space-y-4">
              <section className="space-y-2">
                <p className="font-medium text-sm">{t('settings.about.diagnostics.range_title')}</p>
                <SegmentedControl<DiagnosticRange>
                  value={range}
                  onValueChange={(nextRange) => {
                    setRange(nextRange)
                    setInspectResult(null)
                  }}
                  options={rangeOptions}
                  disabled={status === 'uploading'}
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
                  disabled={status === 'uploading' || isInspectionPending || !logsAvailable}
                  onCheckedChange={setIncludeLogs}
                />
                <SourceRow
                  title={t('settings.about.diagnostics.sources.traces.title')}
                  description={sourceDescription(t, inspectResult?.sources.traces, isInspectionPending)}
                  checked={effectiveIncludeTraces}
                  disabled={status === 'uploading' || isInspectionPending || !tracesAvailable}
                  onCheckedChange={setIncludeTraces}
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
            </div>
          )}
        </Scrollbar>

        <DialogFooter className="mt-4 border-border border-t px-6 py-4">
          {submissionUnknownFallbackSaveFailed ? (
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
              {result.status !== 'uploaded' ? (
                <Button ref={primaryActionRef} variant="emphasis" onClick={() => void openManualForm()}>
                  {t('settings.about.diagnostics.upload.actions.open_form')}
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <Button variant="outline" disabled={status === 'uploading'} onClick={() => handleOpenChange(false)}>
                {t('settings.about.diagnostics.actions.cancel')}
              </Button>
              <Button
                variant="emphasis"
                loading={status === 'uploading'}
                disabled={!canUpload}
                onClick={() => void uploadBundle()}>
                {t(
                  status === 'uploading'
                    ? 'settings.about.diagnostics.upload.actions.uploading'
                    : 'settings.about.diagnostics.upload.actions.consent_upload'
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SubmissionUnknownFallbackSaveFailedContent() {
  const { t } = useTranslation()
  return (
    <div className="flex gap-3 rounded-xl border border-warning-border bg-warning-subtle p-4" role="alert">
      <CircleAlert className="mt-0.5 size-5 shrink-0 text-warning" />
      <div className="min-w-0 space-y-1">
        <p className="font-medium">{t('settings.about.diagnostics.upload.unknown_without_copy.title')}</p>
        <p className="text-muted-foreground text-sm">
          {t('settings.about.diagnostics.upload.unknown_without_copy.description')}
        </p>
      </div>
    </div>
  )
}

function UploadResultContent({ result }: { readonly result: UploadResult }) {
  const { t } = useTranslation()
  if (result.status === 'uploaded') {
    return (
      <div
        className="flex gap-3 rounded-xl border border-success-border bg-success-subtle p-4"
        role="status"
        aria-live="polite"
        aria-atomic="true">
        <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" />
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-success-subtle-foreground">
            {t('settings.about.diagnostics.upload.success.title')}
          </p>
          <p className="text-muted-foreground text-sm">
            {t('settings.about.diagnostics.upload.success.description', {
              included: result.includedFileCount,
              omitted: result.omittedFileCount,
              size: formatBytes(result.archiveBytes)
            })}
          </p>
        </div>
      </div>
    )
  }

  const isUnknown = result.status === 'submission_unknown'
  const reason = isUnknown ? null : result.reason
  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-xl border border-warning-border bg-warning-subtle p-4">
        <CircleAlert className="mt-0.5 size-5 shrink-0 text-warning" />
        <div className="min-w-0 space-y-1">
          <p className="font-medium">
            {t(
              isUnknown
                ? 'settings.about.diagnostics.upload.unknown.title'
                : 'settings.about.diagnostics.upload.manual.title'
            )}
          </p>
          <p className="text-muted-foreground text-sm">
            {t(
              isUnknown
                ? 'settings.about.diagnostics.upload.unknown.description'
                : 'settings.about.diagnostics.upload.manual.description'
            )}
          </p>
          {reason ? <p className="text-muted-foreground text-xs">{fallbackReasonText(t, reason)}</p> : null}
          <p className="break-all text-xs">{result.fileName}</p>
        </div>
      </div>
    </div>
  )
}

function fallbackReasonText(t: ReturnType<typeof useTranslation>['t'], reason: DiagnosticUploadFallbackReason): string {
  const keys: Record<DiagnosticUploadFallbackReason, string> = {
    attachment_upload_failed: 'settings.about.diagnostics.upload.reasons.attachment_upload_failed',
    form_changed: 'settings.about.diagnostics.upload.reasons.form_changed',
    form_unavailable: 'settings.about.diagnostics.upload.reasons.form_unavailable',
    network_failed: 'settings.about.diagnostics.upload.reasons.network_failed',
    submission_rejected: 'settings.about.diagnostics.upload.reasons.submission_rejected'
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
