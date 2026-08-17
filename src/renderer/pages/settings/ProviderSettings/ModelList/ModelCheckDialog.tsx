import {
  Alert,
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
import type { ModelCheckKeySelection } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { getModelHealthCheckSkipReason } from '@renderer/pages/settings/ProviderSettings/utils/healthCheck'
import { maskApiKey } from '@renderer/utils/api'
import type { Model } from '@shared/data/types/model'
import type { ApiKeyEntry } from '@shared/data/types/provider'
import { sortBy } from 'es-toolkit/compat'
import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ApiKeyCheckResults from './ApiKeyCheckResults'
import { useModelListHealthRun } from './modelListHealthContext'

type CheckMode = 'single' | 'all'
type ModelOption = ComboboxOption<{ model: Model }>

function filterModelCheckOption(option: ComboboxOption, search: string) {
  const haystack = [option.label, option.value, option.description].filter(Boolean).join(' ').toLocaleLowerCase()
  return haystack.includes(search.trim().toLocaleLowerCase())
}

function clampTimeout(value: number) {
  if (!Number.isFinite(value)) return 15
  return Math.min(60, Math.max(5, Math.round(value)))
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
  return t('settings.models.check.skip_reason_generation_cost', {
    output
  })
}

function ApiKeyField({
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
  const enabledEntries = entries.filter((entry) => entry.isEnabled)
  const options: ComboboxOption[] = enabledEntries.map((entry) => ({
    value: entry.id,
    label: `${entry.label?.trim() || t('settings.provider.api_key.unnamed')} · ${maskApiKey(entry.key)}`
  }))

  return (
    <div className="space-y-2">
      <Label id={labelId}>{t('settings.models.check.select_api_key')}</Label>
      <Combobox
        aria-labelledby={labelId}
        options={options}
        value={value}
        disabled={disabled || enabledEntries.length === 0}
        filterOption={filterModelCheckOption}
        onChange={(next) => onChange(Array.isArray(next) ? (next[0] ?? '') : next)}
        placeholder={enabledEntries.length === 0 ? t('settings.models.check.no_api_keys') : undefined}
        searchable={enabledEntries.length > 5}
        searchPlaceholder={t('common.search')}
        className="w-full justify-between"
        popoverClassName="w-(--radix-popover-trigger-width)"
        emptyText={t('settings.models.check.no_api_keys')}
      />
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
        <ApiKeyField
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
  const [mode, setMode] = useState<CheckMode>('single')
  const [singleModelId, setSingleModelId] = useState('')
  const [singleKeySelection, setSingleKeySelection] = useState<ModelCheckKeySelection>({ mode: 'all' })
  const [allKeySelection, setAllKeySelection] = useState<ModelCheckKeySelection>({ mode: 'all' })
  const [isConcurrent, setIsConcurrent] = useState(true)
  const [timeoutSeconds, setTimeoutSeconds] = useState(15)
  const [isStarting, setIsStarting] = useState(false)
  const sortedModels = useMemo(() => sortBy(health.models, 'name'), [health.models])
  const checkableModels = useMemo(
    () => sortedModels.filter((model) => !getModelHealthCheckSkipReason(model)),
    [sortedModels]
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
  const selectedModel = sortedModels.find((model) => model.id === singleModelId) ?? checkableModels[0]
  const hasEnabledApiKeys = health.apiKeyEntries.some((entry) => entry.isEnabled)
  const controlsDisabled = isStarting || health.isSingleModelChecking
  const showKeyScope = health.canSelectApiKey && (health.requiresApiKey || hasEnabledApiKeys)
  const singleModelResult = health.singleModelResult
  const showSingleResult =
    singleModelResult != null && selectedModel != null && singleModelResult.model.id === selectedModel.id

  useEffect(() => {
    if (!health.modelCheckOpen) return
    setMode('single')
  }, [health.modelCheckOpen])

  useEffect(() => {
    if (!health.modelCheckOpen) return
    setSingleModelId((current) =>
      current && checkableModels.some((model) => model.id === current) ? current : (checkableModels[0]?.id ?? '')
    )
  }, [checkableModels, health.modelCheckOpen])

  useEffect(() => {
    const enabledIds = new Set(health.apiKeyEntries.filter((entry) => entry.isEnabled).map((entry) => entry.id))
    setSingleKeySelection((current) =>
      current.mode === 'single' && !enabledIds.has(current.keyId) ? { mode: 'all' } : current
    )
    setAllKeySelection((current) =>
      current.mode === 'single' && !enabledIds.has(current.keyId) ? { mode: 'all' } : current
    )
  }, [health.apiKeyEntries])

  const handleStart = async () => {
    setIsStarting(true)
    try {
      if (mode === 'single') {
        if (!selectedModel) return
        await health.startSingleModelCheck({ model: selectedModel, keySelection: singleKeySelection })
        return
      }

      const timeout = clampTimeout(timeoutSeconds)
      setTimeoutSeconds(timeout)
      await health.startHealthCheck({
        keySelection: allKeySelection,
        isConcurrent,
        timeout: timeout * 1000
      })
    } finally {
      setIsStarting(false)
    }
  }

  return (
    <Dialog open={health.modelCheckOpen} onOpenChange={(open) => !open && health.closeModelCheck()}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col gap-4 sm:max-w-145">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t('settings.models.check.title')}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <SegmentedControl<CheckMode>
            aria-label={t('settings.models.check.model_scope')}
            className="w-fit"
            value={mode}
            disabled={controlsDisabled}
            options={[
              { value: 'single', label: t('settings.models.check.single_model') },
              { value: 'all', label: t('settings.models.check.all_models') }
            ]}
            onValueChange={setMode}
          />
          <Alert
            type="warning"
            showIcon
            description={t(
              mode === 'all' ? 'settings.models.check.all_models_disclaimer' : 'settings.models.check.disclaimer'
            )}
          />

          {mode === 'single' ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label id={modelLabelId}>{t('settings.models.check.model')}</Label>
                <Combobox<{ model: Model }>
                  aria-labelledby={modelLabelId}
                  options={modelOptions}
                  value={selectedModel?.id ?? ''}
                  disabled={controlsDisabled || checkableModels.length === 0}
                  filterOption={filterModelCheckOption}
                  onChange={(value) => {
                    setSingleModelId(Array.isArray(value) ? (value[0] ?? '') : value)
                    health.resetSingleModelResult()
                  }}
                  className="w-full justify-between"
                  popoverClassName="w-(--radix-popover-trigger-width) [&_[data-slot=command-list]]:max-h-72"
                  placeholder={checkableModels.length === 0 ? t('settings.provider.no_models_for_check') : undefined}
                  emptyText={
                    checkableModels.length === 0 ? t('settings.provider.no_models_for_check') : t('common.no_results')
                  }
                  searchPlaceholder={t('common.search')}
                />
              </div>
              {showKeyScope ? (
                <ApiKeyScopeField
                  entries={health.apiKeyEntries}
                  selection={singleKeySelection}
                  disabled={controlsDisabled}
                  onChange={(selection) => {
                    setSingleKeySelection(selection)
                    health.resetSingleModelResult()
                  }}
                />
              ) : null}
              {showSingleResult ? (
                <ApiKeyCheckResults
                  keyResults={singleModelResult.keyResults}
                  apiKeyEntries={health.apiKeyEntries}
                  savingKeyId={health.savingKeyId}
                  onToggleKey={health.toggleApiKey}
                />
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              {showKeyScope ? (
                <ApiKeyScopeField
                  entries={health.apiKeyEntries}
                  selection={allKeySelection}
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
          )}
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={health.closeModelCheck}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={isStarting || (mode === 'single' && health.isSingleModelChecking)}
            disabled={
              isStarting ||
              health.isModelChecking ||
              (health.requiresApiKey && !hasEnabledApiKeys) ||
              (mode === 'single' ? !selectedModel : sortedModels.length === 0)
            }
            onClick={() => void handleStart()}>
            {t('settings.models.check.start')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
