import { Alert, DescriptionSwitch, SegmentedControl } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { describeDiagnosticChatSource, describeDiagnosticFileSource } from '@renderer/utils/diagnosticSourceSummary'
import type { DiagnosticRange } from '@shared/ipc/schemas/diagnostics'
import type { OutputFor } from '@shared/ipc/types'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('DiagnosticSourceSelector')
const RANGE_OPTIONS = [
  { translationKey: 'settings.about.diagnostics.ranges.24h', value: '24h' },
  { translationKey: 'settings.about.diagnostics.ranges.3d', value: '3d' },
  { translationKey: 'settings.about.diagnostics.ranges.7d', value: '7d' }
] as const
const RANGE_TRANSLATION_KEYS = Object.fromEntries(
  RANGE_OPTIONS.map(({ translationKey, value }) => [value, translationKey])
) as Record<DiagnosticRange, (typeof RANGE_OPTIONS)[number]['translationKey']>

type InspectResult = OutputFor<'diagnostics.bundle.inspect'>

export function diagnosticRangeLabelKey(range: DiagnosticRange) {
  return RANGE_TRANSLATION_KEYS[range]
}

export function useDiagnosticSourceSelection(onSelectionChange: () => void) {
  const [range, setRange] = useState<DiagnosticRange>('24h')
  const [includeLogs, setIncludeLogs] = useState(true)
  const [includeTraces, setIncludeTraces] = useState(true)
  const [includeChatRecords, setIncludeChatRecords] = useState(false)
  const [inspectResult, setInspectResult] = useState<InspectResult | null>(null)
  const [inspectError, setInspectError] = useState(false)
  const [isInspecting, setIsInspecting] = useState(false)

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
        logger.error('Failed to inspect diagnostic sources', error as Error)
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

  const logsAvailable = inspectResult?.sources.logs.available ?? false
  const tracesAvailable = inspectResult?.sources.traces.available ?? false
  const chatRecordsAvailable = inspectResult?.sources.chatRecords.available ?? false
  const effectiveIncludeLogs = includeLogs && logsAvailable
  const effectiveIncludeTraces = includeTraces && tracesAvailable
  const effectiveIncludeChatRecords = includeChatRecords && chatRecordsAvailable
  const isInspectionPending = !inspectError && (isInspecting || inspectResult === null)

  const changeRange = (nextRange: DiagnosticRange) => {
    setRange(nextRange)
    setInspectResult(null)
    onSelectionChange()
  }

  const changeLogs = (checked: boolean) => {
    setIncludeLogs(checked)
    onSelectionChange()
  }

  const changeTraces = (checked: boolean) => {
    setIncludeTraces(checked)
    onSelectionChange()
  }

  const changeChatRecords = (checked: boolean) => {
    setIncludeChatRecords(checked)
    onSelectionChange()
  }

  return {
    changeChatRecords,
    changeLogs,
    changeRange,
    changeTraces,
    effectiveIncludeChatRecords,
    effectiveIncludeLogs,
    effectiveIncludeTraces,
    includesSensitiveData: effectiveIncludeLogs || effectiveIncludeTraces || effectiveIncludeChatRecords,
    inspectError,
    inspectResult,
    isInspectionPending,
    isReady: inspectResult !== null && !isInspectionPending && !inspectError,
    range
  }
}

export function DiagnosticSourceSelector({
  disabled,
  selection
}: {
  readonly disabled: boolean
  readonly selection: ReturnType<typeof useDiagnosticSourceSelection>
}) {
  const { t } = useTranslation()
  const rangeOptions = RANGE_OPTIONS.map(({ translationKey, value }) => ({ label: t(translationKey), value }))
  const { inspectResult, isInspectionPending } = selection

  return (
    <div>
      <span className="sr-only" role="status" aria-live="polite">
        {isInspectionPending ? t('settings.about.diagnostics.inspecting') : ''}
      </span>
      <div className="space-y-4">
        <section className="space-y-2">
          <p className="font-medium text-sm">{t('settings.about.diagnostics.range_title')}</p>
          <SegmentedControl<DiagnosticRange>
            value={selection.range}
            onValueChange={selection.changeRange}
            options={rangeOptions}
            className="w-full"
            disabled={disabled}
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
              aria-label={t('settings.about.diagnostics.sources.logs.title')}
              label={t('settings.about.diagnostics.sources.logs.title')}
              description={describeDiagnosticFileSource(t, inspectResult?.sources.logs, isInspectionPending)}
              checked={selection.effectiveIncludeLogs}
              disabled={disabled || isInspectionPending || !inspectResult?.sources.logs.available}
              onCheckedChange={selection.changeLogs}
            />
          </div>
          <div className="p-1">
            <DescriptionSwitch
              aria-label={t('settings.about.diagnostics.sources.traces.title')}
              label={t('settings.about.diagnostics.sources.traces.title')}
              description={describeDiagnosticFileSource(t, inspectResult?.sources.traces, isInspectionPending)}
              checked={selection.effectiveIncludeTraces}
              disabled={disabled || isInspectionPending || !inspectResult?.sources.traces.available}
              onCheckedChange={selection.changeTraces}
            />
          </div>
          <div className="p-1">
            <DescriptionSwitch
              aria-label={t('settings.about.diagnostics.sources.chat_records.title')}
              label={t('settings.about.diagnostics.sources.chat_records.title')}
              description={describeDiagnosticChatSource(t, inspectResult?.sources.chatRecords, isInspectionPending)}
              checked={selection.effectiveIncludeChatRecords}
              disabled={disabled || isInspectionPending || !inspectResult?.sources.chatRecords.available}
              onCheckedChange={selection.changeChatRecords}
            />
          </div>
        </section>

        {selection.inspectError ? (
          <p className="text-error text-sm" role="alert">
            {t('settings.about.diagnostics.errors.inspect_failed')}
          </p>
        ) : null}
        {inspectResult?.hasWarnings ? (
          <Alert type="warning" showIcon description={t('settings.about.diagnostics.warning')} />
        ) : null}
      </div>
    </div>
  )
}
