import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { Model } from '@shared/data/types/model'
import { MODEL_METADATA_FIELDS, type ModelMetadataField } from '@shared/data/types/modelMetadata'

export function ModelProviderMetadataControls({
  model,
  disabled,
  onChange
}: {
  model: Model
  disabled?: boolean
  onChange: (model: Model) => void
}) {
  const { t } = useTranslation()
  const fieldLabels = {
    contextWindow: t('settings.models.metadata.field.contextWindow'),
    maxOutputTokens: t('settings.models.metadata.field.maxOutputTokens'),
    capabilities: t('settings.models.metadata.field.capabilities')
  }
  const sourceLabels = {
    provider: t('settings.models.metadata.source.provider'),
    registry: t('settings.models.metadata.source.registry'),
    user: t('settings.models.metadata.source.user'),
    unknown: t('settings.models.metadata.source.unknown')
  }
  const [busy, setBusy] = useState(false)
  const currentId = useRef(model.id)
  currentId.current = model.id
  const run = async (field?: ModelMetadataField) => {
    if (busy || disabled) return
    setBusy(true)
    const requestedId = model.id
    try {
      const request = {
        providerId: model.providerId,
        modelId: model.apiModelId ?? model.id.split('::').slice(1).join('::')
      }
      const updated = field
        ? await ipcApi.request('ai.provider.model.reset_metadata', { ...request, field })
        : await ipcApi.request('ai.provider.model.refresh_metadata', request)
      if (currentId.current === requestedId) onChange(updated)
    } catch {
      if (currentId.current === requestedId) toast.error(t('settings.models.metadata.failed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mb-4 space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{t('settings.models.metadata.title')}</span>
        <Button type="button" variant="outline" size="sm" disabled={disabled || busy} onClick={() => void run()}>
          {t(busy ? 'settings.models.metadata.refreshing' : 'settings.models.metadata.refresh')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('settings.models.metadata.help')}</p>
      {MODEL_METADATA_FIELDS.map((field) => (
        <div key={field} className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span>
            {fieldLabels[field]}: {sourceLabels[model.metadataSources?.[field] ?? 'unknown']}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || busy || model.providerMetadata?.[field] === undefined}
            onClick={() => void run(field)}
            aria-label={`${t('settings.models.metadata.reset')} ${fieldLabels[field]}`}>
            {t('settings.models.metadata.reset')}
          </Button>
        </div>
      ))}
    </div>
  )
}
