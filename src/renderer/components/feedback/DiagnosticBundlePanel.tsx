import { Alert, Button, Checkbox, DescriptionSwitch, DialogFooter, Scrollbar, SegmentedControl } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import {
  describeDiagnosticChatSource,
  describeDiagnosticFileSource,
  formatDiagnosticBytes
} from '@renderer/utils/diagnosticSourceSummary'
import { diagnosticsErrorCodes } from '@shared/ipc/errors/diagnostics'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { DiagnosticRange } from '@shared/ipc/schemas/diagnostics'
import type { OutputFor } from '@shared/ipc/types'
import { createFilePathHandle } from '@shared/utils/file'
import { CircleCheck } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const SUPPORT_EMAIL = 'support@cherry-ai.com'
const logger = loggerService.withContext('DiagnosticBundlePanel')
const RANGE_OPTIONS = [
  { translationKey: 'settings.about.diagnostics.ranges.24h', value: '24h' },
  { translationKey: 'settings.about.diagnostics.ranges.3d', value: '3d' },
  { translationKey: 'settings.about.diagnostics.ranges.7d', value: '7d' }
] as const
const RANGE_TRANSLATION_KEYS = Object.fromEntries(
  RANGE_OPTIONS.map(({ translationKey, value }) => [value, translationKey])
) as Record<DiagnosticRange, (typeof RANGE_OPTIONS)[number]['translationKey']>

type InspectResult = OutputFor<'diagnostics.bundle.inspect'>
type SavedResult = Extract<OutputFor<'diagnostics.bundle.export'>, { status: 'saved' }>
type ExportState =
  | { readonly status: 'idle' }
  | { readonly status: 'saving' }
  | { readonly result: SavedResult; readonly status: 'saved' }

interface DiagnosticBundlePanelProps {
  readonly appVersion: string
  readonly onBusyChange?: (busy: boolean) => void
  readonly onClose: () => void
}

function isDestinationConflictError(error: unknown): boolean {
  return (
    error instanceof IpcError &&
    (error.code === diagnosticsErrorCodes.DESTINATION_INSIDE_SOURCE ||
      error.code === diagnosticsErrorCodes.DESTINATION_IS_SOURCE)
  )
}

const DiagnosticBundlePanel: FC<DiagnosticBundlePanelProps> = ({ appVersion, onBusyChange, onClose }) => {
  const { t } = useTranslation()
  const [range, setRange] = useState<DiagnosticRange>('24h')
  const [includeLogs, setIncludeLogs] = useState(true)
  const [includeTraces, setIncludeTraces] = useState(true)
  const [includeChatRecords, setIncludeChatRecords] = useState(false)
  const [consent, setConsent] = useState(false)
  const [isConfirmationOpen, setIsConfirmationOpen] = useState(false)
  const [inspectResult, setInspectResult] = useState<InspectResult | null>(null)
  const [inspectError, setInspectError] = useState(false)
  const [isInspecting, setIsInspecting] = useState(false)
  const [copyEmailFallback, setCopyEmailFallback] = useState(false)
  const [exportState, setExportState] = useState<ExportState>({ status: 'idle' })
  const revealButtonRef = useRef<HTMLButtonElement>(null)
  const exportButtonRef = useRef<HTMLButtonElement>(null)
  const confirmationHeadingRef = useRef<HTMLHeadingElement>(null)
  const confirmationWasOpenRef = useRef(false)
  const status = exportState.status
  const savedResult = exportState.status === 'saved' ? exportState.result : null

  useEffect(() => {
    let active = true
    setIsInspecting(true)
    setInspectError(false)
    void ipcApi
      .request('diagnostics.bundle.inspect', { range })
      .then((result) => {
        if (active) setInspectResult(result)
      })
      .catch((error) => {
        if (!active) return
        logger.error('Failed to inspect diagnostic bundle sources', error as Error)
        setInspectResult(null)
        setInspectError(true)
      })
      .finally(() => {
        if (active) setIsInspecting(false)
      })
    return () => {
      active = false
    }
  }, [range])

  useEffect(() => {
    if (status === 'saved') revealButtonRef.current?.focus()
  }, [status])

  useEffect(() => {
    if (isConfirmationOpen) {
      confirmationWasOpenRef.current = true
      confirmationHeadingRef.current?.focus()
      return
    }
    if (!confirmationWasOpenRef.current) return
    if (status === 'idle') {
      exportButtonRef.current?.focus()
      confirmationWasOpenRef.current = false
    } else if (status === 'saved') {
      confirmationWasOpenRef.current = false
    }
  }, [isConfirmationOpen, status])

  const logsAvailable = inspectResult?.sources.logs.available ?? false
  const tracesAvailable = inspectResult?.sources.traces.available ?? false
  const chatRecordsAvailable = inspectResult?.sources.chatRecords.available ?? false
  const effectiveIncludeLogs = includeLogs && logsAvailable
  const effectiveIncludeTraces = includeTraces && tracesAvailable
  const effectiveIncludeChatRecords = includeChatRecords && chatRecordsAvailable
  const includesSensitiveData = effectiveIncludeLogs || effectiveIncludeTraces || effectiveIncludeChatRecords
  const isInspectionPending = !inspectError && (isInspecting || inspectResult === null)
  const canExport = inspectResult !== null && !isInspectionPending && !inspectError && status !== 'saving'
  const hasInspectWarnings = inspectResult?.hasWarnings ?? false
  const hasSavedWarnings = savedResult?.hasWarnings ?? false

  useEffect(() => onBusyChange?.(status === 'saving'), [onBusyChange, status])

  const changeRange = (nextRange: DiagnosticRange) => {
    setRange(nextRange)
    setInspectResult(null)
    setConsent(false)
  }

  const changeLogs = (checked: boolean) => {
    setIncludeLogs(checked)
    setConsent(false)
  }

  const changeTraces = (checked: boolean) => {
    setIncludeTraces(checked)
    setConsent(false)
  }

  const changeChatRecords = (checked: boolean) => {
    setIncludeChatRecords(checked)
    setConsent(false)
  }

  const handleClose = () => {
    if (status === 'saving') return
    setIsConfirmationOpen(false)
    setConsent(false)
    onClose()
  }

  const performExport = async () => {
    if (!canExport) return
    if (includesSensitiveData) setConsent(false)
    setExportState({ status: 'saving' })
    try {
      const result = await ipcApi.request('diagnostics.bundle.export', {
        includeChatRecords: effectiveIncludeChatRecords,
        includeLogs: effectiveIncludeLogs,
        includeTraces: effectiveIncludeTraces,
        range
      })
      if (result.status === 'canceled') {
        setExportState({ status: 'idle' })
        return
      }
      if (result.status === 'busy') {
        setExportState({ status: 'idle' })
        toast.error(t('settings.about.diagnostics.errors.busy'))
        return
      }
      setExportState({ result, status: 'saved' })
    } catch (error) {
      logger.error('Failed to export diagnostic bundle', error as Error)
      setExportState({ status: 'idle' })
      toast.error(
        t(
          isDestinationConflictError(error)
            ? 'settings.about.diagnostics.errors.destination_conflict'
            : 'settings.about.diagnostics.errors.export_failed'
        )
      )
    }
  }

  const handleExport = () => {
    if (!canExport) return
    if (includesSensitiveData) {
      setConsent(false)
      setIsConfirmationOpen(true)
      return
    }
    void performExport()
  }

  const handleConfirmationOpenChange = (nextOpen: boolean) => {
    setIsConfirmationOpen(nextOpen)
    if (!nextOpen) setConsent(false)
  }

  const handleConfirmedExport = () => {
    if (!consent) return
    setIsConfirmationOpen(false)
    void performExport()
  }

  const handleReveal = async () => {
    if (!savedResult) return
    try {
      await ipcApi.request('file.show_in_folder', createFilePathHandle(savedResult.filePath))
    } catch (error) {
      logger.error('Failed to reveal diagnostic bundle', error as Error)
      toast.error(t('settings.about.diagnostics.errors.reveal_failed'))
    }
  }

  const copySupportEmail = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL)
      toast.success(t('settings.about.diagnostics.success.email_copied'))
    } catch {
      toast.error(t('settings.about.diagnostics.errors.copy_failed'))
    }
  }

  const handleContactSupport = async () => {
    if (!savedResult) return
    const params = new URLSearchParams({
      subject: t('settings.about.diagnostics.mail.subject', { bundleId: savedResult.bundleId }),
      body: t('settings.about.diagnostics.mail.body', {
        bundleId: savedResult.bundleId,
        fileName: savedResult.fileName,
        platform: window.electron.process.platform,
        range: t(RANGE_TRANSLATION_KEYS[range]),
        version: appVersion || t('settings.about.diagnostics.unknown')
      })
    })
    try {
      const query = params.toString().replaceAll('+', '%20')
      await ipcApi.request('system.shell.open_website', `mailto:${SUPPORT_EMAIL}?${query}`)
    } catch (error) {
      logger.error('Failed to open support email client', error as Error)
      setCopyEmailFallback(true)
      toast.error(t('settings.about.diagnostics.errors.email_client_failed'))
    }
  }

  const rangeOptions = RANGE_OPTIONS.map(({ translationKey, value }) => ({
    label: t(translationKey),
    value
  }))

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-0 overflow-hidden">
      <Scrollbar className="min-h-0 px-6 py-2">
        <span className="sr-only" role="status">
          {isInspectionPending ? t('settings.about.diagnostics.inspecting') : ''}
        </span>
        {isConfirmationOpen ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <h3 ref={confirmationHeadingRef} tabIndex={-1} className="font-semibold text-base">
                {t('settings.about.diagnostics.privacy.title')}
              </h3>
              <p className="text-muted-foreground text-sm leading-6">
                {t('settings.about.diagnostics.privacy.description')}
              </p>
            </div>
            <p className="text-muted-foreground text-sm leading-6">
              {t('settings.about.diagnostics.limit', {
                size: formatDiagnosticBytes(inspectResult?.sourceLimitBytes ?? 50 * 1024 * 1024)
              })}
            </p>
            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <Checkbox checked={consent} onCheckedChange={(checked) => setConsent(checked === true)} />
              <span>{t('settings.about.diagnostics.privacy.consent')}</span>
            </label>
          </div>
        ) : status === 'saved' && savedResult ? (
          <div className="space-y-4">
            <div className="flex gap-3 rounded-xl border border-success-border bg-success-subtle p-4">
              <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" />
              <div className="min-w-0 space-y-1">
                <p className="font-medium text-success-subtle-foreground">
                  {t('settings.about.diagnostics.success.title')}
                </p>
                <p className="break-all text-sm">{savedResult.fileName}</p>
                <p className="text-muted-foreground text-xs">
                  {t('settings.about.diagnostics.success.summary', {
                    included: savedResult.includedFileCount,
                    omitted: savedResult.omittedFileCount,
                    size: formatDiagnosticBytes(savedResult.archiveBytes)
                  })}
                </p>
              </div>
            </div>
            {hasSavedWarnings && (
              <Alert type="warning" showIcon description={t('settings.about.diagnostics.warning')} />
            )}
            <p className="text-muted-foreground text-sm">{t('settings.about.diagnostics.success.local_only')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <section className="space-y-2">
              <p className="font-medium text-sm">{t('settings.about.diagnostics.range_title')}</p>
              <SegmentedControl<DiagnosticRange>
                value={range}
                onValueChange={changeRange}
                options={rangeOptions}
                className="w-full"
                disabled={status === 'saving'}
              />
            </section>

            <section className="divide-y divide-border rounded-xl border border-border">
              <div className="p-1">
                <DescriptionSwitch
                  label={t('settings.about.diagnostics.sources.system.title')}
                  description={t('settings.about.diagnostics.sources.system.description', {
                    crashCount: inspectResult?.sources.crashDumps.fileCount ?? 0
                  })}
                  checked
                  disabled
                />
              </div>
              <div className="p-1">
                <DescriptionSwitch
                  label={t('settings.about.diagnostics.sources.logs.title')}
                  description={describeDiagnosticFileSource(t, inspectResult?.sources.logs, isInspectionPending)}
                  checked={effectiveIncludeLogs}
                  disabled={status === 'saving' || isInspectionPending || !logsAvailable}
                  onCheckedChange={changeLogs}
                />
              </div>
              <div className="p-1">
                <DescriptionSwitch
                  label={t('settings.about.diagnostics.sources.traces.title')}
                  description={describeDiagnosticFileSource(t, inspectResult?.sources.traces, isInspectionPending)}
                  checked={effectiveIncludeTraces}
                  disabled={status === 'saving' || isInspectionPending || !tracesAvailable}
                  onCheckedChange={changeTraces}
                />
              </div>
              <div className="p-1">
                <DescriptionSwitch
                  label={t('settings.about.diagnostics.sources.chat_records.title')}
                  description={describeDiagnosticChatSource(t, inspectResult?.sources.chatRecords, isInspectionPending)}
                  checked={effectiveIncludeChatRecords}
                  disabled={status === 'saving' || isInspectionPending || !chatRecordsAvailable}
                  onCheckedChange={changeChatRecords}
                />
              </div>
            </section>

            {inspectError && (
              <p className="text-error text-sm" role="alert">
                {t('settings.about.diagnostics.errors.inspect_failed')}
              </p>
            )}
            {!isInspecting && hasInspectWarnings && (
              <Alert type="warning" showIcon description={t('settings.about.diagnostics.warning')} />
            )}
          </div>
        )}
      </Scrollbar>

      <DialogFooter className="mt-4 border-border border-t px-6 py-4">
        {isConfirmationOpen ? (
          <>
            <Button variant="outline" onClick={() => handleConfirmationOpenChange(false)}>
              {t('settings.about.diagnostics.actions.cancel')}
            </Button>
            <Button variant="emphasis" disabled={!consent} onClick={handleConfirmedExport}>
              {t('settings.about.diagnostics.actions.export')}
            </Button>
          </>
        ) : status === 'saved' ? (
          <>
            <Button variant="outline" onClick={handleClose}>
              {t('settings.about.diagnostics.actions.close')}
            </Button>
            <Button ref={revealButtonRef} variant="outline" onClick={() => void handleReveal()}>
              {t('settings.about.diagnostics.actions.reveal')}
            </Button>
            <Button
              variant="emphasis"
              onClick={() => void (copyEmailFallback ? copySupportEmail() : handleContactSupport())}>
              {t(
                copyEmailFallback
                  ? 'settings.about.diagnostics.actions.copy_email'
                  : 'settings.about.diagnostics.actions.contact'
              )}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" disabled={status === 'saving'} onClick={handleClose}>
              {t('settings.about.diagnostics.actions.cancel')}
            </Button>
            <Button
              ref={exportButtonRef}
              variant="emphasis"
              loading={status === 'saving'}
              disabled={!canExport}
              onClick={handleExport}>
              {t(
                status === 'saving'
                  ? 'settings.about.diagnostics.actions.exporting'
                  : 'settings.about.diagnostics.actions.export'
              )}
            </Button>
          </>
        )}
      </DialogFooter>
    </div>
  )
}

export default DiagnosticBundlePanel
