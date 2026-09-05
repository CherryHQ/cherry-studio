import { Button } from '@cherrystudio/ui'
import type { SerializedError } from '@renderer/types/error'
import type { DiagnosisContext } from '@renderer/utils/errorDiagnosis'
import { Copy, Eye } from 'lucide-react'
import type { Ref } from 'react'
import { useTranslation } from 'react-i18next'

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
    <section className="rounded-xl border border-border bg-secondary p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium text-sm">{t('error.diagnostics.basic_information')}</h2>
        <div className="flex flex-wrap items-center gap-1">
          <Button variant="ghost" size="sm" disabled={!error} onClick={onCopy}>
            <Copy className="size-4" />
            {t('common.copy')}
          </Button>
          <Button ref={viewDetailsButtonRef} variant="ghost" size="sm" onClick={onViewDetails}>
            <Eye className="size-4" />
            {t('error.diagnosis.view_details')}
          </Button>
        </div>
      </div>

      {fields.length > 0 ? (
        <dl className="mt-3 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
          {fields.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="selectable min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  )
}
