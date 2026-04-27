import { Button, RadioGroup, RadioGroupItem, SelectDropdown } from '@cherrystudio/ui'
import { maskApiKey } from '@renderer/utils/api'
import type { Model } from '@shared/data/types/model'
import { sortBy } from 'lodash'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderSettingsDrawer from './ProviderSettingsDrawer'
import { drawerClasses } from './ProviderSettingsPrimitives'

interface ProviderConnectionCheckDrawerProps {
  open: boolean
  models: Model[]
  apiKeys: string[]
  isSubmitting: boolean
  onClose: () => void
  onStart: (config: { model: Model; apiKey: string }) => Promise<void>
}

export default function ProviderConnectionCheckDrawer({
  open,
  models,
  apiKeys,
  isSubmitting,
  onClose,
  onStart
}: ProviderConnectionCheckDrawerProps) {
  const { t } = useTranslation()
  const sortedModels = useMemo(() => sortBy(models, 'name'), [models])
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const [selectedKeyIndex, setSelectedKeyIndex] = useState(0)

  useEffect(() => {
    if (!open) {
      return
    }

    setSelectedModelId(sortedModels[0]?.id ?? '')
    setSelectedKeyIndex(0)
  }, [open, sortedModels])

  const selectedModel = useMemo(
    () => sortedModels.find((item) => item.id === selectedModelId) ?? sortedModels[0],
    [selectedModelId, sortedModels]
  )

  const selectedApiKey = apiKeys[selectedKeyIndex] ?? apiKeys[0] ?? ''
  const hasMultipleKeys = apiKeys.length > 1

  const footer = (
    <div className={drawerClasses.footer}>
      <Button variant="outline" onClick={onClose}>
        {t('common.cancel')}
      </Button>
      <Button
        disabled={!selectedModel || !selectedApiKey}
        loading={isSubmitting}
        onClick={() => selectedModel && void onStart({ model: selectedModel, apiKey: selectedApiKey })}>
        {t('settings.models.check.start')}
      </Button>
    </div>
  )

  return (
    <ProviderSettingsDrawer
      open={open}
      onClose={onClose}
      title={t('message.api.check.model.title')}
      size="form"
      footer={footer}>
      <div className={drawerClasses.section}>
        <div className={drawerClasses.fieldList}>
          <div className="space-y-2">
            <label className="font-medium text-[13px] text-foreground/85">{t('settings.models.list_title')}</label>
            <SelectDropdown
              items={sortedModels.map((item) => ({ id: item.id, label: item.name }))}
              selectedId={selectedModel?.id}
              onSelect={(value) => setSelectedModelId(value as string)}
              renderSelected={(item) => <span className="truncate">{item.label}</span>}
              renderItem={(item) => <span className="truncate">{item.label}</span>}
            />
          </div>

          {hasMultipleKeys ? (
            <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
              <div className="font-medium text-[13px] text-foreground/85">
                {t('settings.models.check.select_api_key')}
              </div>
              <RadioGroup
                value={String(selectedKeyIndex)}
                onValueChange={(value) => setSelectedKeyIndex(Number(value))}>
                {apiKeys.map((key, index) => (
                  <label
                    key={`${key}-${index}`}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-transparent px-2 py-1.5 hover:bg-accent/30">
                    <RadioGroupItem value={String(index)} size="sm" />
                    <span className="truncate font-mono text-[12px] text-foreground/70">{maskApiKey(key)}</span>
                  </label>
                ))}
              </RadioGroup>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="font-medium text-[13px] text-foreground/85">{t('settings.provider.api_key.label')}</div>
              <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 font-mono text-[12px] text-foreground/70">
                {selectedApiKey ? maskApiKey(selectedApiKey) : '—'}
              </div>
            </div>
          )}
        </div>
      </div>
    </ProviderSettingsDrawer>
  )
}
