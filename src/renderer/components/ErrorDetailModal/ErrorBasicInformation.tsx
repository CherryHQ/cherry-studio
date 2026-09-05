import { Button, Tooltip } from '@cherrystudio/ui'
import type { SerializedError } from '@renderer/types/error'
import type { DiagnosisContext } from '@renderer/utils/errorDiagnosis'
import { Copy, Eye } from 'lucide-react'
import type { Ref } from 'react'
import { useTranslation } from 'react-i18next'

import { DiagnosticsPanel } from '../DiagnosticsPanel'
import type { DiagnosticReportConfig } from './diagnosticReportDescription'

interface ErrorBasicInformationProps {
  readonly diagnosisContext?: DiagnosisContext
  readonly diagnosticReport?: DiagnosticReportConfig
  readonly error?: SerializedError
  readonly onCopy: () => void
  readonly onViewDetails: () => void
  readonly viewDetailsButtonRef?: Ref<HTMLButtonElement>
}

type BasicField = readonly [label: string, value: string | number]

function basicField(label: string, value: unknown): BasicField | undefined {
  if (typeof value === 'number') return [label, value]
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized ? [label, normalized] : undefined
}

export function ErrorBasicInformation({
  diagnosisContext,
  diagnosticReport,
  error,
  onCopy,
  onViewDetails,
  viewDetailsButtonRef
}: ErrorBasicInformationProps) {
  const { t } = useTranslation()
  const errorRecord = error as Record<string, unknown> | undefined
  const fields = [
    basicField(t('error.diagnostic_report.location'), diagnosticReport?.location ?? diagnosisContext?.errorSource),
    basicField(t('error.provider'), diagnosisContext?.providerName),
    basicField(t('error.modelId'), diagnosisContext?.modelId),
    basicField(t('error.name'), error?.name),
    basicField(t('error.statusCode'), errorRecord?.status ?? errorRecord?.statusCode),
    basicField(t('error.message'), error?.message)
  ].filter((field): field is BasicField => field !== undefined)

  return (
    <DiagnosticsPanel
      title={t('error.diagnostics.basic_information')}
      actions={
        <div className="flex items-center gap-1">
          <Tooltip content={t('common.copy')}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('common.copy')}
              disabled={!error}
              onClick={onCopy}>
              <Copy className="size-4" />
            </Button>
          </Tooltip>
          <Tooltip content={t('error.diagnosis.view_details')}>
            <Button
              ref={viewDetailsButtonRef}
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('error.diagnosis.view_details')}
              onClick={onViewDetails}>
              <Eye className="size-4" />
            </Button>
          </Tooltip>
        </div>
      }
      bodyClassName="px-4 pb-4">
      {fields.length > 0 ? (
        <dl className="overflow-hidden rounded-lg border border-border bg-background text-xs">
          {fields.map(([label, value]) => (
            <div
              key={label}
              className="grid gap-x-4 gap-y-1 border-border border-t px-4 py-3 first:border-t-0 sm:grid-cols-[14rem_minmax(0,1fr)]">
              <dt className="font-medium">{label}</dt>
              <dd className="selectable min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </DiagnosticsPanel>
  )
}
