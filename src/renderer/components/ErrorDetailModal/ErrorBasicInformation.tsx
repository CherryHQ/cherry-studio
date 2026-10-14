import { Copy, Eye } from 'lucide-react'
import type { Ref } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
import type { SerializedError } from '@renderer/types/error'
import type { DiagnosisContext } from '@renderer/utils/errorDiagnosis'

import { DiagnosticsPanel } from '../DiagnosticsPanel'
import {
  type DiagnosticReportConfig,
  type DiagnosticReportDescriptionLabels,
  diagnosticReportFields,
  resolveDiagnosticReportLocation
} from './diagnosticReportDescription'

interface ErrorBasicInformationProps {
  readonly diagnosisContext?: DiagnosisContext
  readonly diagnosticReport?: DiagnosticReportConfig
  readonly error?: SerializedError
  readonly localizedErrorMessage?: string
  readonly onCopy: () => void
  readonly onViewDetails: () => void
  readonly viewDetailsButtonRef?: Ref<HTMLButtonElement>
}

export function ErrorBasicInformation({
  diagnosisContext,
  diagnosticReport,
  error,
  localizedErrorMessage,
  onCopy,
  onViewDetails,
  viewDetailsButtonRef
}: ErrorBasicInformationProps) {
  const { t, i18n } = useTranslation()
  const location = diagnosticReport?.location ?? diagnosisContext?.errorSource
  const locationLabel = location?.trim() ? resolveDiagnosticReportLocation(t, location, i18n.language) : undefined
  const labels = {
    errorMessage: t('error.message'),
    location: t('error.diagnostic_report.location'),
    model: t('error.modelId')
  } satisfies DiagnosticReportDescriptionLabels
  const fields = diagnosticReportFields({
    diagnosisContext,
    error,
    location: locationLabel,
    localizedErrorMessage
  }).filter(({ id }) => id !== 'location')
  const title = locationLabel ?? t('error.diagnostics.basic_information')

  return (
    <DiagnosticsPanel
      title={title}
      variant="sectioned"
      actions={
        <div className="flex items-center gap-1">
          <Tooltip content={t('common.copy')}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground dark:text-muted-foreground"
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
              className="text-muted-foreground dark:text-muted-foreground"
              aria-label={t('error.diagnosis.view_details')}
              onClick={onViewDetails}>
              <Eye className="size-4" />
            </Button>
          </Tooltip>
        </div>
      }>
      {fields.length > 0 ? (
        <dl className="text-xs">
          {fields.map(({ id, value }) => (
            <div
              key={id}
              className="grid gap-x-4 gap-y-1 border-t border-border px-4 py-3 first:border-t-0 sm:grid-cols-[14rem_minmax(0,1fr)]">
              <dt className="font-medium">{labels[id]}</dt>
              <dd className="selectable min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </DiagnosticsPanel>
  )
}
