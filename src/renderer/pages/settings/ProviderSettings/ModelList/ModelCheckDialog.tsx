import {
  Alert,
  Avatar,
  AvatarFallback,
  Button,
  Combobox,
  type ComboboxOption,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  SegmentedControl,
  Switch
} from '@cherrystudio/ui'
import { useIcon } from '@cherrystudio/ui/icons'
import { showErrorDetailPopup } from '@renderer/components/ErrorDetailModal'
import type { ModelCheckKeySelection } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import {
  getModelHealthCheckSkipReason,
  healthCheckErrorToDisplayString
} from '@renderer/pages/settings/ProviderSettings/utils/healthCheck'
import { maskApiKey } from '@renderer/utils/api'
import { getModelLogoRef } from '@renderer/utils/model'
import type { Model } from '@shared/data/types/model'
import type { ApiKeyEntry } from '@shared/data/types/provider'
import { sortBy } from 'es-toolkit/compat'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { drawerClasses } from '../primitives/ProviderSettingsPrimitives'
import { useModelListHealthRun } from './modelListHealthContext'

type DialogView = 'single' | 'all'
type ModelOption = ComboboxOption<{ model: Model }>

const CONNECTION_ERROR_DESCRIPTION_COLOR = 'var(--muted-foreground)'
const CONNECTION_ERROR_DETAIL_COLOR = 'var(--foreground-tertiary)'

function filterModelCheckOption(option: ComboboxOption, search: string) {
  const haystack = [option.label, option.value, option.description].filter(Boolean).join(' ').toLocaleLowerCase()
  return haystack.includes(search.trim().toLocaleLowerCase())
}

function clampTimeout(value: number) {
  if (!Number.isFinite(value)) return 15
  return Math.min(60, Math.max(5, Math.round(value)))
}

function getEffectiveKeySelection(
  selection: ModelCheckKeySelection,
  entries: readonly ApiKeyEntry[]
): ModelCheckKeySelection {
  if (selection.mode === 'single' && !entries.some((entry) => entry.isEnabled && entry.id === selection.keyId)) {
    return { mode: 'all' }
  }
  return selection
}

function getSkipReasonDescription(model: Model, t: ReturnType<typeof useTranslation>['t']) {
  const reason = getModelHealthCheckSkipReason(model)
  if (!reason) return undefined
  if (reason.kind === 'unsupported_probe') return t('settings.models.check.skip_reason_unsupported_probe')
  const output =
    reason.output === 'image'
      ? t('settings.models.check.generation_output_image')
      : reason.output === 'video'
        ? t('settings.models.check.generation_output_video')
        : t('settings.models.check.generation_output_audio')
  return t('settings.models.check.skip_reason_generation_cost', { output })
}

function ModelOptionIcon({ model, size = 20 }: { model: Model; size?: number }) {
  const Icon = useIcon(getModelLogoRef(model))

  return Icon ? (
    <Icon.Avatar size={size} />
  ) : (
    <Avatar size="sm">
      <AvatarFallback>{model.name.trim().charAt(0) || 'M'}</AvatarFallback>
    </Avatar>
  )
}

function renderModelOptionContent(model: Model, description?: string) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <ModelOptionIcon model={model} />
      <div className="min-w-0 flex-1">
        <div className="truncate" title={model.name}>
          {model.name}
        </div>
        {description ? <div className="truncate text-muted-foreground text-xs">{description}</div> : null}
      </div>
    </div>
  )
}

function ApiKeySelectField({
  entries,
  value,
  disabled,
  onChange
}: {
  entries: readonly ApiKeyEntry[]
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const labelId = useId()
  const options: ComboboxOption[] = entries.map((entry) => ({ value: entry.id, label: maskApiKey(entry.key) }))

  return (
    <div>
      <Label id={labelId} className="mb-2.5 block text-[13px] text-foreground">
        {t('settings.models.check.select_api_key')}
      </Label>
      <Combobox
        aria-labelledby={labelId}
        className="h-9 w-full justify-between px-2.5 text-left font-mono text-[12px]"
        emptyText={t('common.no_results')}
        filterOption={filterModelCheckOption}
        options={options}
        value={value}
        disabled={disabled || entries.length === 0}
        onChange={(next) => onChange(Array.isArray(next) ? (next[0] ?? '') : next)}
        placeholder={t('settings.models.check.select_api_key')}
        popoverClassName="w-(--radix-popover-trigger-width)"
        renderOption={(option) => <span className="truncate font-mono text-[12px]">{option.label}</span>}
        renderValue={(nextValue, nextOptions) => {
          const selectedValue = Array.isArray(nextValue) ? nextValue[0] : nextValue
          const option = nextOptions.find((item) => item.value === selectedValue)
          return option ? <span className="truncate font-mono text-[12px]">{option.label}</span> : null
        }}
        searchable={entries.length > 5}
        searchPlaceholder={t('common.search')}
      />
    </div>
  )
}

function SingleApiKeyField({
  entries,
  value,
  disabled,
  onChange
}: {
  entries: readonly ApiKeyEntry[]
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()

  if (entries.length > 1) {
    return <ApiKeySelectField entries={entries} value={value} disabled={disabled} onChange={onChange} />
  }

  const selectedEntry = entries[0]
  return (
    <div className="space-y-1.5">
      <div className="text-[13px] text-muted-foreground">{t('settings.provider.api_key.label')}</div>
      <div className="rounded-md border border-border-subtle bg-muted/20 px-3 py-2 font-mono text-[12px] text-foreground">
        {selectedEntry ? maskApiKey(selectedEntry.key) : '—'}
      </div>
    </div>
  )
}

function ApiKeyScopeField({
  entries,
  selection,
  disabled,
  onChange
}: {
  entries: readonly ApiKeyEntry[]
  selection: ModelCheckKeySelection
  disabled: boolean
  onChange: (selection: ModelCheckKeySelection) => void
}) {
  const { t } = useTranslation()
  const labelId = useId()
  const enabledEntries = entries.filter((entry) => entry.isEnabled)

  if (enabledEntries.length === 0) {
    return (
      <div className="space-y-2">
        <Label id={labelId}>{t('settings.models.check.key_scope')}</Label>
        <p className="text-muted-foreground text-sm">{t('settings.models.check.no_api_keys')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <Label id={labelId}>{t('settings.models.check.key_scope')}</Label>
        <SegmentedControl<ModelCheckKeySelection['mode']>
          aria-labelledby={labelId}
          disabled={disabled}
          size="sm"
          value={selection.mode}
          options={[
            { value: 'single', label: t('settings.models.check.single') },
            { value: 'all', label: t('settings.models.check.all') }
          ]}
          onValueChange={(mode) =>
            onChange(mode === 'all' ? { mode: 'all' } : { mode: 'single', keyId: enabledEntries[0].id })
          }
        />
      </div>
      {selection.mode === 'single' && enabledEntries.length > 1 ? (
        <ApiKeySelectField
          entries={enabledEntries}
          value={selection.keyId}
          disabled={disabled}
          onChange={(keyId) => onChange({ mode: 'single', keyId })}
        />
      ) : null}
    </div>
  )
}

export default function ModelCheckDialog() {
  const { t } = useTranslation()
  const modelLabelId = useId()
  const health = useModelListHealthRun()
  const [view, setView] = useState<DialogView>('single')
  const [singleModelId, setSingleModelId] = useState('')
  const [singleKeyId, setSingleKeyId] = useState('')
  const [allKeySelection, setAllKeySelection] = useState<ModelCheckKeySelection>({ mode: 'all' })
  const [isConcurrent, setIsConcurrent] = useState(true)
  const [timeoutSeconds, setTimeoutSeconds] = useState(15)
  const [isStarting, setIsStarting] = useState(false)
  const effectiveAllKeySelection = getEffectiveKeySelection(allKeySelection, health.apiKeyEntries)
  const sortedModels = useMemo(() => sortBy(health.models, 'name'), [health.models])
  const checkableModels = useMemo(
    () => sortedModels.filter((model) => !getModelHealthCheckSkipReason(model)),
    [sortedModels]
  )
  const enabledApiKeyEntries = useMemo(
    () => health.apiKeyEntries.filter((entry) => entry.isEnabled),
    [health.apiKeyEntries]
  )
  const modelOptions = useMemo<ModelOption[]>(
    () =>
      sortedModels.map((model) => ({
        value: model.id,
        label: model.name,
        model,
        disabled: Boolean(getModelHealthCheckSkipReason(model)),
        description: getSkipReasonDescription(model, t)
      })),
    [sortedModels, t]
  )
  const selectedModel = checkableModels.find((model) => model.id === singleModelId) ?? checkableModels[0]
  const selectedKeyEntry = enabledApiKeyEntries.find((entry) => entry.id === singleKeyId) ?? enabledApiKeyEntries[0]
  const singleKeySelection: ModelCheckKeySelection =
    health.canSelectApiKey && selectedKeyEntry ? { mode: 'single', keyId: selectedKeyEntry.id } : { mode: 'all' }
  const hasEnabledApiKeys = enabledApiKeyEntries.length > 0
  const controlsDisabled = isStarting || health.isSingleModelChecking
  const showKeyScope = health.canSelectApiKey && (health.requiresApiKey || hasEnabledApiKeys)
  const singleModelResult = health.singleModelResult
  const showSingleResult =
    singleModelResult != null && selectedModel != null && singleModelResult.model.id === selectedModel.id
  const singleError = (() => {
    if (!showSingleResult || singleModelResult?.kind !== 'failed') return undefined
    if (singleKeySelection.mode === 'single') {
      const selectedResult = singleModelResult.keyResults.find(
        (result) => result.credential.kind === 'api-key' && result.credential.entry.id === singleKeySelection.keyId
      )
      if (selectedResult?.kind === 'failed') return selectedResult.error
    }
    const failedResult = singleModelResult.keyResults.find((result) => result.kind === 'failed')
    return failedResult?.kind === 'failed' ? failedResult.error : singleModelResult.error
  })()
  const singleErrorText = healthCheckErrorToDisplayString(singleError)

  useEffect(() => {
    if (!health.modelCheckOpen) return
    setView('single')
  }, [health.modelCheckOpen])

  useEffect(() => {
    if (!health.modelCheckOpen) return
    setSingleModelId((current) =>
      current && checkableModels.some((model) => model.id === current) ? current : (checkableModels[0]?.id ?? '')
    )
  }, [checkableModels, health.modelCheckOpen])

  useEffect(() => {
    if (!health.modelCheckOpen) return
    setSingleKeyId((current) =>
      current && enabledApiKeyEntries.some((entry) => entry.id === current)
        ? current
        : (enabledApiKeyEntries[0]?.id ?? '')
    )
  }, [enabledApiKeyEntries, health.modelCheckOpen])

  const handleStart = async () => {
    setIsStarting(true)
    try {
      if (view === 'single') {
        if (!selectedModel) return
        await health.startSingleModelCheck({ model: selectedModel, keySelection: singleKeySelection })
        return
      }

      const timeout = clampTimeout(timeoutSeconds)
      setTimeoutSeconds(timeout)
      await health.startHealthCheck({
        keySelection: effectiveAllKeySelection,
        isConcurrent,
        timeout: timeout * 1000
      })
    } finally {
      setIsStarting(false)
    }
  }

  const handleShowConnectionErrorDetail = () => {
    if (singleError) showErrorDetailPopup({ error: singleError })
  }

  const startDisabled =
    isStarting ||
    health.isModelChecking ||
    (health.requiresApiKey && !hasEnabledApiKeys) ||
    (view === 'single' ? !selectedModel : sortedModels.length === 0)

  return (
    <Dialog open={health.modelCheckOpen} onOpenChange={(open) => !open && health.closeModelCheck()}>
      <DialogContent
        className={
          view === 'single' ? 'gap-4 sm:max-w-[520px]' : 'flex max-h-[calc(100vh-2rem)] flex-col gap-4 sm:max-w-145'
        }>
        <DialogHeader className={view === 'all' ? 'shrink-0' : undefined}>
          <DialogTitle className={view === 'single' ? 'text-base leading-5' : undefined}>
            {t(view === 'single' ? 'message.api.check.model.title' : 'settings.models.check.title')}
          </DialogTitle>
        </DialogHeader>

        {view === 'single' ? (
          <div className="space-y-4">
            <div className="space-y-3">
              <div>
                <Label id={modelLabelId} className="mb-2.5 block text-[13px] text-foreground">
                  {t('button.select_model')}
                </Label>
                {sortedModels.length > 0 ? (
                  <Combobox<{ model: Model }>
                    aria-labelledby={modelLabelId}
                    className="h-9 w-full justify-between px-2.5 text-left font-normal"
                    disabled={controlsDisabled || checkableModels.length === 0}
                    emptyText={
                      checkableModels.length === 0 ? t('settings.provider.no_models_for_check') : t('common.no_results')
                    }
                    filterOption={filterModelCheckOption}
                    options={checkableModels.length === 0 ? [] : modelOptions}
                    value={selectedModel?.id ?? ''}
                    onChange={(value) => {
                      setSingleModelId(Array.isArray(value) ? (value[0] ?? '') : value)
                      health.resetSingleModelResult()
                    }}
                    placeholder={
                      checkableModels.length === 0
                        ? t('settings.provider.no_models_for_check')
                        : t('settings.models.empty')
                    }
                    popoverClassName="w-(--radix-popover-trigger-width)! [&_[data-slot=command-list]]:max-h-[280px]"
                    renderOption={(option) => renderModelOptionContent(option.model, option.description)}
                    renderValue={(value, options) => {
                      const selectedValue = Array.isArray(value) ? value[0] : value
                      const option = options.find((item) => item.value === selectedValue)
                      return option
                        ? renderModelOptionContent(option.model)
                        : checkableModels.length === 0
                          ? t('settings.provider.no_models_for_check')
                          : null
                    }}
                    searchPlaceholder={t('common.search')}
                  />
                ) : (
                  <div className={drawerClasses.emptyInline}>{t('settings.provider.no_models_for_check')}</div>
                )}
              </div>

              {health.canSelectApiKey ? (
                <SingleApiKeyField
                  entries={enabledApiKeyEntries}
                  value={selectedKeyEntry?.id ?? ''}
                  disabled={controlsDisabled}
                  onChange={(keyId) => {
                    setSingleKeyId(keyId)
                    health.resetSingleModelResult()
                  }}
                />
              ) : null}
            </div>

            {singleErrorText ? (
              <button
                type="button"
                aria-label={`${t('message.api.connection.failed')}: ${singleErrorText}. ${t('common.detail')}`}
                className="group w-full cursor-pointer rounded-lg border border-border border-l-[3px] border-l-error-border bg-transparent px-3.5 py-3 text-left text-[13px] transition-all duration-200 focus-visible:border-ring focus-visible:bg-accent/30 focus-visible:outline-none"
                onClick={handleShowConnectionErrorDetail}>
                <div className="mb-1.5 flex items-center gap-2">
                  <div className="flex shrink-0 items-center justify-center text-error">
                    <AlertTriangle size={15} className="lucide-custom" />
                  </div>
                  <div className="pr-5 text-[13px] leading-[1.4]">{t('message.api.connection.failed')}</div>
                </div>
                <div
                  className="ml-5.75 line-clamp-3 text-xs leading-normal [overflow-wrap:anywhere]"
                  style={{ color: CONNECTION_ERROR_DESCRIPTION_COLOR }}>
                  {singleErrorText}
                </div>
                <div className="mt-2.5 ml-5.75 flex items-center">
                  <div
                    className="ml-auto inline-flex items-center gap-0.5 text-xs transition-colors duration-150 group-hover:text-foreground"
                    style={{ color: CONNECTION_ERROR_DETAIL_COLOR }}>
                    {t('common.detail')}
                    <ChevronRight size={14} />
                  </div>
                </div>
              </button>
            ) : null}
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <Alert type="warning" showIcon description={t('settings.models.check.all_models_disclaimer')} />
            <div className="space-y-4">
              {showKeyScope ? (
                <ApiKeyScopeField
                  entries={health.apiKeyEntries}
                  selection={effectiveAllKeySelection}
                  disabled={controlsDisabled}
                  onChange={setAllKeySelection}
                />
              ) : null}
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="model-check-concurrent">{t('settings.models.check.enable_concurrent')}</Label>
                  <p className="mt-1 text-muted-foreground text-xs">{t('settings.models.check.concurrent_hint')}</p>
                </div>
                <Switch id="model-check-concurrent" checked={isConcurrent} onCheckedChange={setIsConcurrent} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="model-check-timeout">{t('settings.models.check.timeout')}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="model-check-timeout"
                    type="number"
                    min={5}
                    max={60}
                    value={timeoutSeconds}
                    className="w-24"
                    onChange={(event) => setTimeoutSeconds(Number(event.target.value))}
                    onBlur={() => setTimeoutSeconds(clampTimeout(timeoutSeconds))}
                  />
                  <span className="text-muted-foreground text-sm">{t('settings.models.check.timeout_unit')}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {view === 'single' ? (
          <DialogFooter className="mt-1 flex-row items-center justify-between gap-3 sm:justify-between">
            <div>
              <Button
                variant="outline"
                className="h-9 px-3 text-sm"
                disabled={controlsDisabled || health.isModelChecking}
                onClick={() => setView('all')}>
                {t('settings.models.check.model_button_caption')}
              </Button>
            </div>
            <div className={drawerClasses.footer}>
              <Button variant="outline" onClick={health.closeModelCheck}>
                {t('common.cancel')}
              </Button>
              <Button
                disabled={startDisabled}
                loading={isStarting || health.isSingleModelChecking}
                onClick={() => void handleStart()}>
                {t('settings.models.check.start')}
              </Button>
            </div>
          </DialogFooter>
        ) : (
          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={health.closeModelCheck}>
              {t('common.cancel')}
            </Button>
            <Button disabled={startDisabled} loading={isStarting} onClick={() => void handleStart()}>
              {t('settings.models.check.start')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
