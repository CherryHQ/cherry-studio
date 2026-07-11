import {
  Avatar,
  AvatarFallback,
  Button,
  Combobox,
  type ComboboxOption,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import { showErrorDetailPopup } from '@renderer/components/ErrorDetailModal'
import type { SerializedError } from '@renderer/types/error'
import { maskApiKey } from '@renderer/utils/api'
import { getModelLogo } from '@renderer/utils/model'
import type { Model } from '@shared/data/types/model'
import { sortBy } from 'es-toolkit/compat'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { drawerClasses } from '../primitives/ProviderSettingsPrimitives'
import { healthCheckErrorToDisplayString } from '../utils/healthCheck'

interface ProviderConnectionCheckDrawerProps {
  open: boolean
  models: readonly Model[]
  apiKeys: string[]
  connectionError?: SerializedError
  isSubmitting: boolean
  requiresApiKey?: boolean
  onClose: () => void
  onStart: (config: { model: Model; apiKey: string }) => Promise<void>
  onOpenModelHealthCheck?: () => void
}

type ModelOption = ComboboxOption<{ model: Model }>
type ApiKeyOption = ComboboxOption

function renderModelIcon(model: Model, size = 20) {
  const Icon = getModelLogo(model)

  return Icon ? (
    <Icon.Avatar size={size} />
  ) : (
    <Avatar size="sm">
      <AvatarFallback>{model.name.trim().charAt(0) || 'M'}</AvatarFallback>
    </Avatar>
  )
}

function renderModelOptionContent(model: Model) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {renderModelIcon(model)}
      <span className="min-w-0 flex-1 truncate" title={model.name}>
        {model.name}
      </span>
    </div>
  )
}

export default function ProviderConnectionCheckDrawer({
  open,
  models,
  apiKeys,
  connectionError,
  isSubmitting,
  requiresApiKey = true,
  onClose,
  onStart,
  onOpenModelHealthCheck
}: ProviderConnectionCheckDrawerProps) {
  const { t } = useTranslation()
  const sortedModels = useMemo(() => sortBy(models, 'name'), [models])
  const modelOptions = useMemo<ModelOption[]>(
    () => sortedModels.map((model) => ({ value: model.id, label: model.name, model })),
    [sortedModels]
  )
  const apiKeyOptions = useMemo<ApiKeyOption[]>(
    () => apiKeys.map((key, index) => ({ value: String(index), label: maskApiKey(key) })),
    [apiKeys]
  )
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
  const connectionErrorText = healthCheckErrorToDisplayString(connectionError)
  const handleShowConnectionErrorDetail = () => {
    showErrorDetailPopup({ error: connectionError })
  }
  const handleOpenModelHealthCheck = () => {
    onClose()
    onOpenModelHealthCheck?.()
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="gap-4 sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="text-base leading-5">{t('message.api.check.model.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-3">
            <div>
              <label className="mb-2.5 block font-medium text-[13px] text-foreground/85">
                {t('button.select_model')}
              </label>
              {sortedModels.length > 0 ? (
                <Combobox
                  className="h-9 w-full justify-between px-2.5 text-left font-normal"
                  emptyText={t('common.no_results')}
                  options={modelOptions}
                  value={selectedModel?.id ?? ''}
                  onChange={(value) => setSelectedModelId(Array.isArray(value) ? (value[0] ?? '') : value)}
                  placeholder={t('settings.models.empty')}
                  popoverClassName="w-(--radix-popover-trigger-width) [&_[data-slot=command-list]]:max-h-[280px]"
                  renderOption={(option) => renderModelOptionContent(option.model)}
                  renderValue={(value, options) => {
                    const selectedValue = Array.isArray(value) ? value[0] : value
                    const option = options.find((item) => item.value === selectedValue)

                    return option ? renderModelOptionContent(option.model) : null
                  }}
                  searchPlaceholder={t('common.search')}
                />
              ) : (
                <div className={drawerClasses.emptyInline}>{t('settings.provider.no_models_for_check')}</div>
              )}
            </div>

            {hasMultipleKeys ? (
              <div>
                <label className="mb-2.5 block font-medium text-[13px] text-foreground/85">
                  {t('settings.models.check.select_api_key')}
                </label>
                <Combobox
                  className="h-9 w-full justify-between px-2.5 text-left font-mono text-[12px]"
                  emptyText={t('common.no_results')}
                  options={apiKeyOptions}
                  value={String(selectedKeyIndex)}
                  onChange={(value) => setSelectedKeyIndex(Number(Array.isArray(value) ? (value[0] ?? 0) : value))}
                  placeholder={t('settings.models.check.select_api_key')}
                  popoverClassName="w-(--radix-popover-trigger-width)"
                  renderOption={(option) => <span className="truncate font-mono text-[12px]">{option.label}</span>}
                  renderValue={(value, options) => {
                    const selectedValue = Array.isArray(value) ? value[0] : value
                    const option = options.find((item) => item.value === selectedValue)

                    return option ? <span className="truncate font-mono text-[12px]">{option.label}</span> : null
                  }}
                  searchPlaceholder={t('common.search')}
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="font-medium text-[13px] text-foreground/85">{t('settings.provider.api_key.label')}</div>
                <div className="rounded-md border border-border-muted bg-muted/20 px-3 py-2 font-mono text-[12px] text-foreground/70">
                  {selectedApiKey ? maskApiKey(selectedApiKey) : '—'}
                </div>
              </div>
            )}
          </div>
        </div>
        {connectionErrorText ? (
          <button
            type="button"
            aria-label={`${t('message.api.connection.failed')}: ${connectionErrorText}. ${t('common.detail')}`}
            className="group w-full cursor-pointer rounded-lg border border-border border-l-[3px] border-l-error-border bg-transparent px-3.5 py-3 text-left text-[13px] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border"
            onClick={handleShowConnectionErrorDetail}>
            <div className="mb-1.5 flex items-center gap-2">
              <div className="flex shrink-0 items-center justify-center text-error-base">
                <AlertTriangle size={15} className="lucide-custom" />
              </div>
              <div className="pr-5 font-medium text-[13px] leading-[1.4]">{t('message.api.connection.failed')}</div>
            </div>
            <div
              className="wrap-break-word ml-5.75 line-clamp-3 text-xs leading-normal"
              style={{ color: 'var(--color-foreground-secondary)' }}>
              {connectionErrorText}
            </div>
            <div className="mt-2.5 ml-5.75 flex items-center">
              <div
                className="ml-auto inline-flex items-center gap-0.5 text-xs transition-colors duration-150 group-hover:text-foreground"
                style={{ color: 'var(--color-foreground-muted)' }}>
                {t('common.detail')}
                <ChevronRight size={14} />
              </div>
            </div>
          </button>
        ) : null}
        <DialogFooter className="mt-1 flex-row items-center justify-between gap-3 sm:justify-between">
          <div>
            {onOpenModelHealthCheck ? (
              <Button variant="outline" className="h-9 px-3 text-sm" onClick={handleOpenModelHealthCheck}>
                {t('settings.models.check.model_button_caption')}
              </Button>
            ) : null}
          </div>
          <div className={drawerClasses.footer}>
            <Button variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={!selectedModel || (requiresApiKey && !selectedApiKey)}
              loading={isSubmitting}
              onClick={() => selectedModel && void onStart({ model: selectedModel, apiKey: selectedApiKey })}>
              {t('settings.models.check.start')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
