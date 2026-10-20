import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Checkbox } from '@cherrystudio/ui'
import { MODEL_RESET_FIELDS, type ModelResetField } from '@shared/data/api/schemas/models'
import type { Model } from '@shared/data/types/model'

import { resolveProviderModelDefaults } from '../../utils/modelSync'

const labels = {
  capabilities: 'settings.models.add.capabilities.label',
  inputModalities: 'settings.models.add.input_modalities.label',
  outputModalities: 'settings.models.add.output_modalities.label',
  endpointTypes: 'settings.models.add.endpoint_type.label'
} as const

export function ModelDefaultsControls({
  providerId,
  modelId,
  onReset
}: {
  providerId: string
  modelId: string
  onReset: (fields: ModelResetField[]) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const identity = `${providerId}::${modelId}`
  const identityRef = useRef(identity)
  identityRef.current = identity
  const [preview, setPreview] = useState<Model | null>(null)
  const [fields, setFields] = useState<ModelResetField[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setBusy(true)
    setError(null)
    try {
      const [model] = await resolveProviderModelDefaults(providerId, [modelId])
      if (identityRef.current !== identity) return
      if (!model?.presetModelId) {
        setError(t('settings.models.defaults.unavailable'))
        return
      }
      setPreview(model)
      setFields([])
    } catch {
      if (identityRef.current === identity) setError(t('settings.models.manage.operation_failed'))
    } finally {
      if (identityRef.current === identity) setBusy(false)
    }
  }

  async function reset() {
    setBusy(true)
    setError(null)
    try {
      const success = await onReset(fields)
      if (identityRef.current !== identity) return
      if (success) setPreview(null)
      else setError(t('settings.models.manage.operation_failed'))
    } finally {
      if (identityRef.current === identity) setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void load()}>
        {t('settings.models.defaults.preview')}
      </Button>
      {error && (
        <div role="alert" className="text-xs text-error">
          {error}
        </div>
      )}
      {preview && (
        <div className="space-y-3 rounded-md border p-3">
          <p className="text-xs text-muted-foreground">{t('settings.models.defaults.hint')}</p>
          {MODEL_RESET_FIELDS.map((field) => (
            <label key={field} className="flex items-start gap-2 text-xs">
              <Checkbox
                disabled={busy}
                checked={fields.includes(field)}
                onCheckedChange={(checked) =>
                  setFields((current) => (checked ? [...current, field] : current.filter((item) => item !== field)))
                }
              />
              <span>
                {t(labels[field])}
                <span className="mt-1 block break-all text-muted-foreground">{preview[field]?.join(', ') || '—'}</span>
              </span>
            </label>
          ))}
          <Button type="button" size="sm" disabled={busy || fields.length === 0} onClick={() => void reset()}>
            {t('settings.models.defaults.apply')}
          </Button>
        </div>
      )}
    </div>
  )
}
