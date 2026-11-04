import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { relayOriginSchema } from '@cherrystudio/remote-protocol'
import { Button, Field, FieldError, FieldLabel, Input, Switch } from '@cherrystudio/ui'
import { useSharedCacheValue } from '@data/hooks/useCache'
import { usePreference } from '@data/hooks/usePreference'
import { toast } from '@renderer/services/toast'

export function RemoteRelaySettings() {
  const { t } = useTranslation()
  const [origin, setOrigin] = usePreference('feature.remote_access.relay_origin', { optimistic: false })
  const [enabled, setEnabled] = usePreference('feature.remote_access.relay_enabled', { optimistic: false })
  const status = useSharedCacheValue('feature.remote_access.relay_status') ?? 'disabled'
  const statusLabels = {
    disabled: t('deviceConnections.relay.status.disabled'),
    connecting: t('deviceConnections.relay.status.connecting'),
    connected: t('deviceConnections.relay.status.connected'),
    unavailable: t('deviceConnections.relay.status.unavailable')
  }
  const [value, setValue] = useState(origin)
  const [invalid, setInvalid] = useState(false)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setValue(origin)
  }, [origin])
  const save = async (nextEnabled: boolean) => {
    const parsed = relayOriginSchema.safeParse(value.trim())
    if (nextEnabled && !parsed.success) {
      setInvalid(true)
      return
    }
    setSaving(true)
    try {
      if (nextEnabled && parsed.success) await setOrigin(parsed.data)
      await setEnabled(nextEnabled)
    } catch {
      toast.error(t('common.save_failed'))
    } finally {
      setSaving(false)
    }
  }
  return (
    <form
      className="mt-5 flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void save(true)
      }}>
      <div className="flex items-center justify-between gap-3">
        <FieldLabel htmlFor="remote-relay-enabled">{t('deviceConnections.relay.title')}</FieldLabel>
        <Switch
          id="remote-relay-enabled"
          checked={enabled}
          disabled={saving}
          onCheckedChange={(value) => void save(value)}
        />
      </div>
      <Field data-invalid={invalid}>
        <FieldLabel htmlFor="remote-relay-origin">{t('deviceConnections.relay.address')}</FieldLabel>
        <div className="flex gap-2">
          <Input
            id="remote-relay-origin"
            value={value}
            disabled={saving}
            aria-invalid={invalid}
            aria-describedby={invalid ? 'remote-relay-error' : undefined}
            placeholder="https://relay.example.com"
            onChange={(event) => {
              setValue(event.target.value)
              setInvalid(false)
            }}
          />
          {value !== origin && (
            <Button type="submit" variant="outline" loading={saving}>
              {t('common.save')}
            </Button>
          )}
        </div>
        {invalid && <FieldError id="remote-relay-error">{t('deviceConnections.relay.invalid')}</FieldError>}
      </Field>
      <p aria-live="polite" className="text-muted-foreground text-xs">
        {statusLabels[status]}
      </p>
    </form>
  )
}
