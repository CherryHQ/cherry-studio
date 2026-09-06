import { Button, Tooltip } from '@cherrystudio/ui'
import type { SerializedError } from '@renderer/types/error'
import type { DiagnosisContext } from '@renderer/utils/errorDiagnosis'
import { Copy, Eye } from 'lucide-react'
import type { Ref } from 'react'
import { useTranslation } from 'react-i18next'

import { DiagnosticsPanel } from '../DiagnosticsPanel'
import {
  type DiagnosticReportConfig,
  type DiagnosticReportDescriptionLabels,
  diagnosticReportFields
} from './diagnosticReportDescription'

interface ErrorBasicInformationProps {
  readonly diagnosisContext?: DiagnosisContext
  readonly diagnosticReport?: DiagnosticReportConfig
  readonly error?: SerializedError
  readonly onCopy: () => void
  readonly onViewDetails: () => void
  readonly viewDetailsButtonRef?: Ref<HTMLButtonElement>
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
  const labels = {
    errorMessage: t('error.message'),
    errorName: t('error.name'),
    location: t('error.diagnostic_report.location'),
    model: t('error.modelId'),
    provider: t('error.provider'),
    statusCode: t('error.statusCode')
  } satisfies DiagnosticReportDescriptionLabels
  const fields = diagnosticReportFields({
    diagnosisContext,
    error,
    location: diagnosticReport?.location ?? diagnosisContext?.errorSource
  })

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
          {fields.map(({ id, value }) => (
            <div
              key={id}
              className="grid gap-x-4 gap-y-1 border-border border-t px-4 py-3 first:border-t-0 sm:grid-cols-[14rem_minmax(0,1fr)]">
              <dt className="font-medium">{labels[id]}</dt>
              <dd className="selectable min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </DiagnosticsPanel>
  )
}
