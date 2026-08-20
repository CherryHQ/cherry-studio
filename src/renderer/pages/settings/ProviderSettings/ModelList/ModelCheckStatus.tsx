import { Button, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import type { ModelWithStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { HealthStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { healthCheckErrorToDisplayString } from '@renderer/pages/settings/ProviderSettings/utils/healthCheck'
import type { ApiKeyEntry } from '@shared/data/types/provider'
import { CheckCircle2, CircleAlert, CircleX, Info, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import ApiKeyCheckResults from './ApiKeyCheckResults'

interface ModelCheckStatusProps {
  result: ModelWithStatus
  apiKeyEntries: readonly ApiKeyEntry[]
  savingKeyId: string | null
  onToggleKey: (keyId: string, enabled: boolean) => Promise<void>
}

function getSkipText(result: Extract<ModelWithStatus, { kind: 'skipped' }>, t: ReturnType<typeof useTranslation>['t']) {
  if (result.skipReason.kind === 'unsupported_probe') return t('settings.models.check.skip_reason_unsupported_probe')
  const output =
    result.skipReason.output === 'image'
      ? t('settings.models.check.generation_output_image')
      : result.skipReason.output === 'video'
        ? t('settings.models.check.generation_output_video')
        : t('settings.models.check.generation_output_audio')
  return t('settings.models.check.skip_reason_generation_cost', {
    output
  })
}

export default function ModelCheckStatus({ result, apiKeyEntries, savingKeyId, onToggleKey }: ModelCheckStatusProps) {
  const { t } = useTranslation()
  const failedCount = result.keyResults.filter((key) => key.status === HealthStatus.FAILED).length
  const passedCount = result.keyResults.filter((key) => key.status === HealthStatus.SUCCESS).length
  const partial = failedCount > 0 && passedCount > 0

  if (result.kind === 'checking') {
    return (
      <span
        className="inline-flex h-7 items-center gap-1 px-2 text-muted-foreground text-xs"
        aria-label={`${result.model.name}: ${t('settings.models.check.status_checking')}`}>
        <Loader2 className="size-4 text-muted-foreground motion-safe:animate-spin" />
        <span>{t('settings.models.check.status_checking')}</span>
      </span>
    )
  }

  const label =
    result.kind === 'skipped'
      ? t('settings.models.check.status_skipped')
      : result.kind === 'ok'
        ? t('settings.models.check.passed')
        : partial
          ? t('settings.models.check.keys_failed_count', { failed: failedCount, total: result.keyResults.length })
          : t('settings.models.check.failed')
  const Icon = result.kind === 'skipped' ? Info : result.kind === 'ok' ? CheckCircle2 : partial ? CircleAlert : CircleX
  const color =
    result.kind === 'ok'
      ? 'text-success'
      : result.kind === 'skipped'
        ? 'text-muted-foreground'
        : partial
          ? 'text-warning'
          : 'text-error'

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={`h-7 gap-1 px-2 text-xs ${color}`}
          aria-label={`${result.model.name}: ${label}`}>
          <Icon className="size-3.5" />
          <span className="max-w-28 truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-96 w-96 overflow-y-auto p-3">
        <div className="mb-2 font-medium text-sm">{result.model.name}</div>
        {result.kind === 'skipped' ? (
          <p className="whitespace-pre-wrap text-muted-foreground text-xs">{getSkipText(result, t)}</p>
        ) : (
          <>
            {result.kind === 'failed' && result.keyResults.length === 0 && result.error ? (
              <p className="mb-2 whitespace-pre-wrap break-words text-error text-xs">
                {healthCheckErrorToDisplayString(result.error)}
              </p>
            ) : null}
            <ApiKeyCheckResults
              keyResults={result.keyResults}
              apiKeyEntries={apiKeyEntries}
              savingKeyId={savingKeyId}
              onToggleKey={onToggleKey}
            />
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
