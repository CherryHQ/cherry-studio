import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
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
import { describeDiagnosticChatSource, describeDiagnosticFileSource } from '@renderer/utils/diagnosticSourceSummary'
import type { DiagnosticRange, DiagnosticUploadFailureReason } from '@shared/ipc/schemas/diagnostics'
import type { OutputFor } from '@shared/ipc/types'
import {
  DIAGNOSTIC_DESCRIPTION_MAX_BYTES,
  DIAGNOSTIC_FEEDBACK_FORM_URL,
  diagnosticDescriptionByteLength
} from '@shared/utils/diagnostics'
import { createFilePathHandle } from '@shared/utils/file'
import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('DiagnosticUploadDialog')
const RANGE_OPTIONS = [
  { translationKey: 'settings.about.diagnostics.ranges.24h', value: '24h' },
  { translationKey: 'settings.about.diagnostics.ranges.3d', value: '3d' },
  { translationKey: 'settings.about.diagnostics.ranges.7d', value: '7d' }
] as const

type InspectResult = OutputFor<'diagnostics.bundle.inspect'>
type UploadResult = OutputFor<'diagnostics.bundle.upload'>
type SavedUploadResult = Extract<OutputFor<'diagnostics.bundle.save_upload'>, { status: 'saved' }>
type OperationStatus = 'discarding' | 'idle' | 'saving' | 'submitting'

function discardRetainedUpload(bundleId: string) {
  return ipcApi.request('diagnostics.bundle.discard_upload', { bundleId })
}

interface DiagnosticUploadDialogProps {
  readonly description?: string
  readonly embedded?: boolean
  readonly fixedRange?: DiagnosticRange
  readonly initialDescription?: string
  readonly onBusyChange?: (busy: boolean) => void
  readonly onDescriptionChange?: (description: string) => void
  readonly onOpenChange: (open: boolean) => void
  readonly open: boolean
}

export interface DiagnosticUploadDialogHandle {
  readonly requestClose: () => Promise<boolean>
}

export const DiagnosticUploadDialog = function DiagnosticUploadDialog({
  ref,
  description: controlledDescription,
  embedded = false,
  fixedRange,
  initialDescription,
  onBusyChange,
  onDescriptionChange,
  onOpenChange,
  open
}: DiagnosticUploadDialogProps & { ref?: React.RefObject<DiagnosticUploadDialogHandle | null> }) {
  const { t } = useTranslation()
  const uploadFormId = useId()
  const [selectedRange, setSelectedRange] = useState<DiagnosticRange>('24h')
  const effectiveRange = fixedRange ?? selectedRange
  const [includeLogs, setIncludeLogs] = useState(true)
  const [includeTraces, setIncludeTraces] = useState(true)
  const [includeChatRecords, setIncludeChatRecords] = useState(false)
  const [internalDescription, setInternalDescription] = useState(initialDescription ?? '')
  const description = controlledDescription ?? internalDescription
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [inspectResult, setInspectResult] = useState<InspectResult | null>(null)
  const [inspectError, setInspectError] = useState(false)
  const [isInspecting, setIsInspecting] = useState(false)
  const [operationStatus, setOperationStatus] = useState<OperationStatus>('idle')
  const [result, setResult] = useState<UploadResult | null>(null)
  const [savedUpload, setSavedUpload] = useState<SavedUploadResult | null>(null)
  const [retainedBundleId, setRetainedBundleId] = useState<string | null>(null)
  const primaryActionRef = useRef<HTMLButtonElement>(null)
  const retainedBundleIdRef = useRef<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      const retainedBundleId = retainedBundleIdRef.current
      if (!retainedBundleId) return
      retainedBundleIdRef.current = null
      void discardRetainedUpload(retainedBundleId).catch((error) =>
        logger.error('Failed to discard retained diagnostic upload on unmount', error as Error)
      )
    }
  }, [])

  useEffect(() => {
    if (!open) return
    let active = true
    setIsInspecting(true)
    setInspectError(false)
    void ipcApi
      .request('diagnostics.bundle.inspect', { range: effectiveRange })
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
  }, [effectiveRange, open])

  useEffect(() => {
    if (result) primaryActionRef.current?.focus()
  }, [result])

  useEffect(() => {
    if (!open) setHasAttemptedSubmit(false)
  }, [open])

  const logsAvailable = inspectResult?.sources.logs.available ?? false
  const tracesAvailable = inspectResult?.sources.traces.available ?? false
  const chatRecordsAvailable = inspectResult?.sources.chatRecords.available ?? false
  const effectiveIncludeLogs = includeLogs && logsAvailable
  const effectiveIncludeTraces = includeTraces && tracesAvailable
  const effectiveIncludeChatRecords = includeChatRecords && chatRecordsAvailable
  const isInspectionPending = open && !inspectError && (isInspecting || inspectResult === null)
  const normalizedDescription = description.trim()
  const descriptionValid =
    normalizedDescription.length > 0 &&
    diagnosticDescriptionByteLength(normalizedDescription) <= DIAGNOSTIC_DESCRIPTION_MAX_BYTES
  const showDescriptionError = hasAttemptedSubmit && !descriptionValid
  const isBusy = operationStatus !== 'idle'
  const canAttemptUpload =
    inspectResult !== null && !isInspectionPending && !inspectError && operationStatus === 'idle' && acknowledged

  useEffect(() => onBusyChange?.(isBusy), [isBusy, onBusyChange])

  const changeDescription = (nextDescription: string) => {
    setInternalDescription(nextDescription)
    onDescriptionChange?.(nextDescription)
  }

  const requestClose = useCallback(async () => {
    if (isBusy) return false
    if (retainedBundleId) {
      setOperationStatus('discarding')
      try {
        const discardResult = await discardRetainedUpload(retainedBundleId)
        if (discardResult.status === 'busy') {
          toast.error(t('settings.about.diagnostics.errors.busy'))
          return false
        }
        retainedBundleIdRef.current = null
        setRetainedBundleId(null)
      } catch (error) {
        logger.error('Failed to discard retained diagnostic upload', error as Error)
        return false
      } finally {
        if (mountedRef.current) setOperationStatus('idle')
      }
    }
    onOpenChange(false)
    return true
  }, [isBusy, onOpenChange, retainedBundleId, t])

  useImperativeHandle(ref, () => ({ requestClose }), [requestClose])

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) void requestClose()
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
    if (!savedUpload) return
    try {
      await ipcApi.request('file.show_in_folder', createFilePathHandle(savedUpload.filePath))
    } catch (error) {
      logger.error('Failed to reveal diagnostic upload fallback', error as Error)
      toast.error(t('settings.about.diagnostics.errors.reveal_failed'))
    }
  }

  const acceptSubmissionResult = (uploadResult: OutputFor<'diagnostics.bundle.upload'>) => {
    if (!mountedRef.current) {
      if (uploadResult.status !== 'busy' && uploadResult.status !== 'uploaded') {
        void discardRetainedUpload(uploadResult.bundleId).catch((error) =>
          logger.error('Failed to discard retained diagnostic upload after unmount', error as Error)
        )
      }
      return
    }
    if (uploadResult.status !== 'busy') {
      const nextBundleId = uploadResult.status === 'uploaded' ? null : uploadResult.bundleId
      retainedBundleIdRef.current = nextBundleId
      setRetainedBundleId(nextBundleId)
    }
    setResult(uploadResult)
  }

  const uploadBundle = async () => {
    if (!canAttemptUpload || !descriptionValid) return
    setOperationStatus('submitting')
    try {
      const uploadResult = await ipcApi.request('diagnostics.bundle.upload', {
        description: normalizedDescription,
        includeChatRecords: effectiveIncludeChatRecords,
        includeLogs: effectiveIncludeLogs,
        includeTraces: effectiveIncludeTraces,
        range: effectiveRange
      })
      acceptSubmissionResult(uploadResult)
    } catch (error) {
      logger.error('Failed to upload diagnostic bundle', error as Error)
      toast.error(t('settings.about.diagnostics.upload.errors.upload_failed'))
    } finally {
      if (mountedRef.current) setOperationStatus('idle')
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setHasAttemptedSubmit(true)
    if (!descriptionValid || !canAttemptUpload) return
    void uploadBundle()
  }

  const retryUpload = async () => {
    if (!result || result.status === 'uploaded' || isBusy) return
    if (!retainedBundleId) {
      await uploadBundle()
      return
    }
    setOperationStatus('submitting')
    try {
      const retryResult = await ipcApi.request('diagnostics.bundle.retry_upload', { bundleId: retainedBundleId })
      acceptSubmissionResult(retryResult)
    } catch (error) {
      logger.error('Failed to retry diagnostic upload', error as Error)
      toast.error(t('settings.about.diagnostics.upload.errors.upload_failed'))
    } finally {
      if (mountedRef.current) setOperationStatus('idle')
    }
  }

  const saveUpload = async () => {
    if (!retainedBundleId || savedUpload || isBusy) return
    setOperationStatus('saving')
    try {
      const saveResult = await ipcApi.request('diagnostics.bundle.save_upload', { bundleId: retainedBundleId })
      if (saveResult.status === 'busy') {
        toast.error(t('settings.about.diagnostics.errors.busy'))
      } else if (saveResult.status === 'saved') {
        setSavedUpload(saveResult)
      }
    } catch (error) {
      logger.error('Failed to save retained diagnostic upload', error as Error)
      toast.error(t('settings.about.diagnostics.upload.errors.save_failed'))
    } finally {
      if (mountedRef.current) setOperationStatus('idle')
    }
  }

  const rangeOptions = RANGE_OPTIONS.map(({ translationKey, value }) => ({
    label: t(translationKey),
    value
  }))

  const panel = (
    <DiagnosticUploadFrame
      embedded={embedded}
      open={open}
      dialogContentProps={{
        size: 'xl',
        className: 'grid max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0',
        closeOnOverlayClick: !isBusy,
        showCloseButton: !isBusy,
        onEscapeKeyDown: (event) => {
          if (isBusy) event.preventDefault()
        }
      }}>
      {!embedded ? (
        <DialogHeader className="px-6 pt-6 pr-12 pb-4">
          <DialogTitle>{t('settings.about.diagnostics.upload.dialog.title')}</DialogTitle>
        </DialogHeader>
      ) : null}

      <Scrollbar className="min-h-0 px-6 py-2">
        <span className="sr-only" role="status" aria-live="polite">
          {isInspectionPending ? t('settings.about.diagnostics.inspecting') : ''}
        </span>
        {result ? (
          <UploadResultContent result={result} savedUpload={savedUpload} onReveal={revealBundle} />
        ) : (
          <form id={uploadFormId} className="space-y-4" onSubmit={handleSubmit}>
            <section className="space-y-2">
              <label htmlFor="diagnostic-description" className="block font-medium text-sm">
                {t('settings.about.diagnostics.report.description_label')}
              </label>
              <Textarea.Input
                id="diagnostic-description"
                value={description}
                onValueChange={changeDescription}
                placeholder={t('settings.about.diagnostics.report.description_placeholder')}
                rows={4}
                disabled={isBusy}
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

            {fixedRange === undefined ? (
              <section className="space-y-2">
                <p className="font-medium text-sm">{t('settings.about.diagnostics.range_title')}</p>
                <SegmentedControl<DiagnosticRange>
                  value={selectedRange}
                  onValueChange={(nextRange) => {
                    setSelectedRange(nextRange)
                    setInspectResult(null)
                    setAcknowledged(false)
                  }}
                  options={rangeOptions}
                  disabled={isBusy}
                />
              </section>
            ) : null}

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
                description={describeDiagnosticFileSource(t, inspectResult?.sources.logs, isInspectionPending)}
                checked={effectiveIncludeLogs}
                disabled={isBusy || isInspectionPending || !logsAvailable}
                onCheckedChange={(checked) => {
                  setIncludeLogs(checked)
                  setAcknowledged(false)
                }}
              />
              <SourceRow
                title={t('settings.about.diagnostics.sources.traces.title')}
                description={describeDiagnosticFileSource(t, inspectResult?.sources.traces, isInspectionPending)}
                checked={effectiveIncludeTraces}
                disabled={isBusy || isInspectionPending || !tracesAvailable}
                onCheckedChange={(checked) => {
                  setIncludeTraces(checked)
                  setAcknowledged(false)
                }}
              />
              <SourceRow
                title={t('settings.about.diagnostics.sources.chat_records.title')}
                description={describeDiagnosticChatSource(t, inspectResult?.sources.chatRecords, isInspectionPending)}
                checked={effectiveIncludeChatRecords}
                disabled={isBusy || isInspectionPending || !chatRecordsAvailable}
                onCheckedChange={(checked) => {
                  setIncludeChatRecords(checked)
                  setAcknowledged(false)
                }}
              />
            </section>

            {inspectError ? (
              <p className="text-error text-sm" role="alert">
                {t('settings.about.diagnostics.errors.inspect_failed')}
              </p>
            ) : null}
            {inspectResult?.hasWarnings ? (
              <Alert type="warning" showIcon description={t('settings.about.diagnostics.warning')} />
            ) : null}
            <label className="flex cursor-pointer items-start gap-3 text-sm" htmlFor="diagnostic-acknowledgement">
              <Checkbox
                id="diagnostic-acknowledgement"
                checked={acknowledged}
                disabled={isBusy}
                onCheckedChange={(checked) => setAcknowledged(checked === true)}
              />
              <span>{t('settings.about.diagnostics.report.acknowledgement')}</span>
            </label>
          </form>
        )}
      </Scrollbar>

      <DialogFooter className="mt-4 border-border border-t px-6 py-4">
        {isBusy ? (
          <Button variant={operationStatus === 'discarding' ? 'destructive' : 'emphasis'} loading disabled>
            {t(
              operationStatus === 'discarding'
                ? 'common.loading'
                : operationStatus === 'saving'
                  ? 'settings.about.diagnostics.report.saving'
                  : 'settings.about.diagnostics.report.submitting'
            )}
          </Button>
        ) : result ? (
          <>
            <Button
              ref={result.status === 'uploaded' ? primaryActionRef : undefined}
              variant={retainedBundleId ? 'destructive' : 'outline'}
              onClick={() => handleOpenChange(false)}>
              {t(retainedBundleId ? 'common.delete' : 'settings.about.diagnostics.actions.close')}
            </Button>
            {result.status !== 'uploaded' && retainedBundleId ? (
              <Button variant="outline" onClick={() => void openManualForm()}>
                {t('settings.about.diagnostics.report.open_manual_form')}
              </Button>
            ) : null}
            {result.status !== 'uploaded' && retainedBundleId && !savedUpload ? (
              <Button variant="outline" onClick={() => void saveUpload()}>
                {t('settings.about.diagnostics.report.save_locally')}
              </Button>
            ) : null}
            {result.status !== 'uploaded' ? (
              <Button ref={primaryActionRef} variant="emphasis" onClick={() => void retryUpload()}>
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
    </DiagnosticUploadFrame>
  )

  return embedded ? (
    panel
  ) : (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {panel}
    </Dialog>
  )
}

function DiagnosticUploadFrame({
  children,
  dialogContentProps,
  embedded,
  open
}: {
  readonly children: ReactNode
  readonly dialogContentProps: React.ComponentProps<typeof DialogContent>
  readonly embedded: boolean
  readonly open: boolean
}) {
  if (embedded) {
    return (
      <div
        hidden={!open}
        className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-0 overflow-hidden"
        aria-hidden={!open}>
        {children}
      </div>
    )
  }
  return <DialogContent {...dialogContentProps}>{children}</DialogContent>
}

function UploadResultContent({
  result,
  savedUpload,
  onReveal
}: {
  readonly result: UploadResult
  readonly savedUpload: SavedUploadResult | null
  readonly onReveal: () => Promise<void>
}) {
  const { t } = useTranslation()
  if (result.status === 'busy') {
    return <Alert type="warning" showIcon role="alert" description={t('settings.about.diagnostics.errors.busy')} />
  }
  if (result.status === 'uploaded') {
    return (
      <Alert type="success" showIcon role="status" aria-live="polite" aria-atomic="true">
        <div className="space-y-2">
          <p className="font-medium">{t('settings.about.diagnostics.report.success_title')}</p>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t('settings.about.diagnostics.report.feedback_id')}</span>
            <code className="break-all">{result.reportId}</code>
            <CopyButton textToCopy={result.reportId} aria-label={t('settings.about.diagnostics.report.copy_id')} />
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
      {savedUpload ? (
        <section
          aria-label={t('settings.about.diagnostics.report.saved_locally')}
          className="flex items-center justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <p className="break-all text-sm">{savedUpload.fileName}</p>
            <p className="text-muted-foreground text-xs">{t('settings.about.diagnostics.report.saved_locally')}</p>
          </div>
          <Button variant="link" className="h-auto shrink-0 px-0 py-0" onClick={() => void onReveal()}>
            {t('settings.about.diagnostics.report.open_location')}
          </Button>
        </section>
      ) : null}
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
