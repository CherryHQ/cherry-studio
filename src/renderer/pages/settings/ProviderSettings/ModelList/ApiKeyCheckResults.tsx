import { Switch } from '@cherrystudio/ui'
import type { ApiKeyWithStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { HealthStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { healthCheckErrorToDisplayString } from '@renderer/pages/settings/ProviderSettings/utils/healthCheck'
import { maskApiKey } from '@renderer/utils/api'
import type { ApiKeyEntry } from '@shared/data/types/provider'
import { CheckCircle2, CircleX, KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface ApiKeyCheckResultsProps {
  keyResults: ApiKeyWithStatus[]
  apiKeyEntries: readonly ApiKeyEntry[]
  savingKeyId?: string | null
  onToggleKey?: (keyId: string, enabled: boolean) => Promise<void>
}

export default function ApiKeyCheckResults({
  keyResults,
  apiKeyEntries,
  savingKeyId,
  onToggleKey
}: ApiKeyCheckResultsProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-2">
      {keyResults.map((result) => {
        if (result.credential.kind === 'provider-auth') {
          return (
            <div key="provider-auth" className="rounded-lg border border-border-subtle bg-muted/30 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <KeyRound className="size-4" />
                {t('settings.models.check.provider_auth')}
              </div>
              {result.kind === 'failed' ? (
                <p className="mt-2 whitespace-pre-wrap break-words text-error text-xs">
                  {healthCheckErrorToDisplayString(result.error)}
                </p>
              ) : null}
            </div>
          )
        }

        const checkedEntry = result.credential.entry
        const currentEntry = apiKeyEntries.find((entry) => entry.id === checkedEntry.id) ?? checkedEntry
        const passed = result.status === HealthStatus.SUCCESS
        const label = currentEntry.label?.trim() || t('settings.provider.api_key.unnamed')

        return (
          <div key={checkedEntry.id} className="rounded-lg border border-border-subtle bg-muted/30 p-3">
            <div className="flex items-center gap-2">
              {passed ? (
                <CheckCircle2 className="size-4 shrink-0 text-success" />
              ) : (
                <CircleX className="size-4 shrink-0 text-error" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-sm">{label}</div>
                <div className="truncate font-mono text-muted-foreground text-xs">{maskApiKey(currentEntry.key)}</div>
              </div>
              <div className="text-right text-xs">
                <div className={passed ? 'text-success' : 'text-error'}>
                  {t(passed ? 'settings.models.check.passed' : 'settings.models.check.failed')}
                </div>
                {passed && result.latency != null ? (
                  <div className="text-muted-foreground">
                    {t('settings.models.check.latency', { latency: result.latency.toFixed(2) })}
                  </div>
                ) : null}
              </div>
              {onToggleKey ? (
                <Switch
                  size="sm"
                  checked={currentEntry.isEnabled}
                  disabled={savingKeyId != null}
                  loading={savingKeyId === checkedEntry.id}
                  aria-label={t('settings.models.check.toggle_key', { name: label })}
                  onCheckedChange={(checked) => void onToggleKey(checkedEntry.id, checked).catch(() => undefined)}
                />
              ) : null}
            </div>
            {result.kind === 'failed' ? (
              <p className="mt-2 whitespace-pre-wrap break-words border-border-subtle border-t pt-2 text-error text-xs">
                {healthCheckErrorToDisplayString(result.error)}
              </p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
