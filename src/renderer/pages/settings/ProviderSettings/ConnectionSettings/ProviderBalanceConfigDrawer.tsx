import { Button, Input, Label, Switch } from '@cherrystudio/ui'
import { useProvider } from '@renderer/hooks/useProvider'
import { ipcApi } from '@renderer/ipc'
import { type ProviderBalance, ProviderBalanceConfigSchema } from '@shared/data/types/providerBalance'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderSettingsDrawer from '../primitives/ProviderSettingsDrawer'
import { balanceErrorKeys } from '../utils/providerBalance'

export function ProviderBalanceConfigDrawer({
  providerId,
  keyId,
  onClose
}: {
  providerId: string
  keyId?: string
  onClose: () => void
}) {
  const { provider, updateProvider } = useProvider(providerId)
  const { t, i18n } = useTranslation()
  const [draft, setDraft] = useState(
    () =>
      provider?.settings.balanceQuery ?? {
        enabled: false,
        endpoint: '',
        amountPath: '',
        currency: 'CNY',
        rechargeUrl: ''
      }
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [invalidFields, setInvalidFields] = useState<string[]>([])
  const [result, setResult] = useState<ProviderBalance>()

  async function submit(test: boolean) {
    const parsed = ProviderBalanceConfigSchema.safeParse(draft)
    if ((test || draft.enabled) && !parsed.success) {
      setInvalidFields(parsed.error.issues.map((issue) => String(issue.path[0])))
      setError('settings.provider.balance_query.error_config')
      return
    }
    setBusy(true)
    setError(undefined)
    setInvalidFields([])
    setResult(undefined)
    try {
      if (test && parsed.success && keyId) {
        setResult(await ipcApi.request('provider.balance.test', { providerId, keyId, config: parsed.data }))
      } else if (!test) {
        await updateProvider({ providerSettings: { balanceQuery: parsed.success ? parsed.data : null } })
        onClose()
      }
    } catch (cause) {
      setError(
        test && cause instanceof IpcError
          ? (balanceErrorKeys[cause.code] ?? 'settings.provider.oauth.balance_error')
          : 'common.save_failed'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <ProviderSettingsDrawer
      open
      onClose={onClose}
      title={t('settings.provider.balance_query.title')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy || !keyId} onClick={() => void submit(true)}>
            {t('settings.provider.balance_query.test')}
          </Button>
          <Button disabled={busy} onClick={() => void submit(false)}>
            {t('common.save')}
          </Button>
        </div>
      }>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="balance-enabled">{t('settings.provider.balance_query.enabled')}</Label>
        <Switch
          id="balance-enabled"
          checked={draft.enabled}
          disabled={busy}
          onCheckedChange={(enabled) => {
            setDraft({ ...draft, enabled })
            setResult(undefined)
          }}
        />
      </div>
      <p className="text-muted-foreground text-xs">{t('settings.provider.balance_query.auth_hint')}</p>
      {(
        [
          ['endpoint', 'settings.provider.balance_query.endpoint'],
          ['amountPath', 'settings.provider.balance_query.amountPath'],
          ['currency', 'settings.provider.balance_query.currency'],
          ['rechargeUrl', 'settings.provider.balance_query.rechargeUrl']
        ] as const
      ).map(([field, label]) => (
        <div key={field} className="space-y-2">
          <Label htmlFor={`balance-${field}`}>{t(label)}</Label>
          <Input
            id={`balance-${field}`}
            value={draft[field] ?? ''}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={invalidFields.includes(field)}
            aria-describedby={invalidFields.includes(field) ? 'balance-config-error' : undefined}
            onChange={(event) => {
              setDraft({ ...draft, [field]: event.target.value })
              setResult(undefined)
              setError(undefined)
              setInvalidFields([])
            }}
          />
        </div>
      ))}
      {error ? (
        <p id="balance-config-error" role="alert" className="text-error text-sm">
          {t(error)}
        </p>
      ) : null}
      <div role="status" aria-live="polite" className="text-sm tabular-nums">
        {busy
          ? t('common.loading')
          : result?.balances
              .map(({ currency, amount }) => `${currency} ${amount.toLocaleString(i18n.language)}`)
              .join(' / ')}
      </div>
    </ProviderSettingsDrawer>
  )
}
