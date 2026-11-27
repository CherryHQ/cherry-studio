import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { advertisedEndpointSchema, directEndpointUrl, parseDirectEndpoint } from '@cherrystudio/remote-protocol'
import {
  Button,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input
} from '@cherrystudio/ui'
import { toast } from '@renderer/services/toast'
import type { AdvertisedRemoteEndpoint } from '@shared/data/preference/preferenceTypes'

export function RemoteEndpointSettings({
  endpoint,
  onSave,
  onCancel
}: {
  endpoint: AdvertisedRemoteEndpoint | null
  onSave: (endpoint: AdvertisedRemoteEndpoint | null) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState(endpoint ? (endpoint.inputUrl ?? directEndpointUrl(endpoint)) : '')
  const [invalid, setInvalid] = useState(false)
  const [saving, setSaving] = useState(false)

  const save = async (address: string) => {
    let next: AdvertisedRemoteEndpoint | null = null
    const inputUrl = address.trim()
    try {
      if (inputUrl) next = { ...advertisedEndpointSchema.parse(parseDirectEndpoint(inputUrl)), inputUrl }
    } catch {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setSaving(true)
    try {
      await onSave(next)
      setValue(inputUrl)
    } catch {
      toast.error(t('common.save_failed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        void save(value)
      }}>
      <DialogHeader>
        <DialogTitle>{t('deviceConnections.endpoint.title')}</DialogTitle>
        <DialogDescription>{t('deviceConnections.endpoint.description')}</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field data-invalid={invalid}>
          <FieldLabel htmlFor="remote-endpoint">{t('deviceConnections.pairing.address')}</FieldLabel>
          <Input
            id="remote-endpoint"
            value={value}
            disabled={saving}
            aria-invalid={invalid}
            aria-describedby={invalid ? 'remote-endpoint-error' : undefined}
            placeholder={t('deviceConnections.endpoint.placeholder')}
            onChange={(event) => {
              setValue(event.target.value)
              setInvalid(false)
            }}
          />
          {invalid && <FieldError id="remote-endpoint-error">{t('deviceConnections.endpoint.invalid')}</FieldError>}
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={saving}>
          {t('common.save')}
        </Button>
      </DialogFooter>
    </form>
  )
}
