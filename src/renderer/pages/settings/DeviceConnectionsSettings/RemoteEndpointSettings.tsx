import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  advertisedEndpointSchema,
  directEndpointUrl,
  parseDirectEndpoint,
  type DirectEndpoint
} from '@cherrystudio/remote-protocol'
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

export function RemoteEndpointSettings({
  endpoint,
  onSave,
  onCancel
}: {
  endpoint: DirectEndpoint | null
  onSave: (endpoint: DirectEndpoint | null) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState(endpoint ? directEndpointUrl(endpoint) : '')
  const [invalid, setInvalid] = useState(false)
  const [saving, setSaving] = useState(false)

  const save = async (address: string) => {
    let next: DirectEndpoint | null = null
    try {
      if (address.trim()) next = advertisedEndpointSchema.parse(parseDirectEndpoint(address.trim()))
    } catch {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setSaving(true)
    try {
      await onSave(next)
      setValue(next ? directEndpointUrl(next) : '')
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
