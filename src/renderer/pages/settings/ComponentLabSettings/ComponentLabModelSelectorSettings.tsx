import { Button, RadioGroup, RadioGroupItem, Switch } from '@cherrystudio/ui'
import { ModelSelector, type ModelSelectorSelectionType } from '@renderer/components/ModelSelector'
import { useModels } from '@renderer/hooks/useModel'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingRow, SettingRowTitle } from '..'

type DebugSelection = Model | Model[] | UniqueModelId | UniqueModelId[] | undefined

const PRIORITIZED_PROVIDER_IDS = ['openai', 'anthropic', 'google', 'gemini', 'openrouter']

function formatSnapshot(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function toIdsFromModel(value: Model | Model[] | undefined): UniqueModelId[] {
  if (!value) return []
  return Array.isArray(value) ? value.map((model) => model.id) : [value.id]
}

function toIdsFromId(value: UniqueModelId | UniqueModelId[] | undefined): UniqueModelId[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function DebugPanel({ testId, title, value }: { testId: string; title: string; value?: string }) {
  return (
    <div className="flex flex-col rounded-[12px] border border-border/70 bg-background p-3">
      <div className="mb-2 font-medium text-foreground text-xs">{title}</div>
      <pre
        className="min-h-[72px] flex-1 overflow-x-auto rounded-[8px] border border-border/50 bg-muted/30 px-3 py-2 font-mono text-muted-foreground text-xs leading-5"
        data-testid={testId}>
        {value ?? '—'}
      </pre>
    </div>
  )
}

const ComponentLabModelSelectorSettings: FC = () => {
  const { t } = useTranslation()
  const { models, isLoading } = useModels({ enabled: true })
  const initialSelectionApplied = useRef(false)

  const [selectedIds, setSelectedIds] = useState<UniqueModelId[]>([])
  const [multiple, setMultiple] = useState(false)
  const [selectionType, setSelectionType] = useState<ModelSelectorSelectionType>('model')
  const [showPinnedModels, setShowPinnedModels] = useState(true)
  const [showTagFilter, setShowTagFilter] = useState(true)
  const [lastReturn, setLastReturn] = useState<DebugSelection>(undefined)
  const [hasLastReturn, setHasLastReturn] = useState(false)

  const modelsById = useMemo(() => new Map(models.map((model) => [model.id, model] as const)), [models])
  const selectedModels = useMemo(
    () =>
      selectedIds.flatMap((modelId) => {
        const model = modelsById.get(modelId)
        return model ? [model] : []
      }),
    [modelsById, selectedIds]
  )

  useEffect(() => {
    if (initialSelectionApplied.current || isLoading || models.length === 0) {
      return
    }

    initialSelectionApplied.current = true
    setSelectedIds([models[0].id])
  }, [isLoading, models])

  // 切换 multiple / selectionType 时清空"最近 onSelect 返回值"面板，避免把旧形态的 payload 留在屏幕上误导
  useEffect(() => {
    setHasLastReturn(false)
    setLastReturn(undefined)
  }, [multiple, selectionType])

  const hasModels = models.length > 0

  const triggerLabel = useMemo(() => {
    if (multiple && selectedModels.length > 1) {
      return t('settings.componentLab.modelSelector.triggerSelectedCount', { count: selectedModels.length })
    }

    return selectedModels[0]?.name || selectedIds[0] || t('settings.componentLab.modelSelector.triggerPlaceholder')
  }, [multiple, selectedIds, selectedModels, t])

  const recordReturn = useCallback((next: DebugSelection) => {
    setHasLastReturn(true)
    setLastReturn(next)
  }, [])

  const handleModelSelect = useCallback(
    (next: Model | Model[] | undefined) => {
      recordReturn(next)
      setSelectedIds(toIdsFromModel(next))
    },
    [recordReturn]
  )

  const handleIdSelect = useCallback(
    (next: UniqueModelId | UniqueModelId[] | undefined) => {
      recordReturn(next)
      setSelectedIds(toIdsFromId(next))
    },
    [recordReturn]
  )

  const trigger = (
    <Button variant="outline" disabled={!hasModels} className="min-w-[280px] justify-between gap-3 text-left">
      <span className="truncate">{triggerLabel}</span>
    </Button>
  )

  const commonProps = {
    trigger,
    showPinnedModels,
    showTagFilter,
    prioritizedProviderIds: PRIORITIZED_PROVIDER_IDS
  }

  const renderSelector = () => {
    if (multiple && selectionType === 'id') {
      return (
        <ModelSelector {...commonProps} multiple selectionType="id" value={selectedIds} onSelect={handleIdSelect} />
      )
    }

    if (multiple) {
      return <ModelSelector {...commonProps} multiple value={selectedModels} onSelect={handleModelSelect} />
    }

    if (selectionType === 'id') {
      return (
        <ModelSelector
          {...commonProps}
          multiple={false}
          selectionType="id"
          value={selectedIds[0]}
          onSelect={handleIdSelect}
        />
      )
    }

    return <ModelSelector {...commonProps} multiple={false} value={selectedModels[0]} onSelect={handleModelSelect} />
  }

  const currentProps = useMemo(
    () => ({
      multiple,
      selectionType,
      showPinnedModels,
      showTagFilter,
      prioritizedProviderIds: PRIORITIZED_PROVIDER_IDS
    }),
    [multiple, selectionType, showPinnedModels, showTagFilter]
  )

  const currentValue = useMemo<DebugSelection>(() => {
    if (selectionType === 'id') {
      return multiple ? selectedIds : selectedIds[0]
    }

    return multiple ? selectedModels : selectedModels[0]
  }, [multiple, selectedIds, selectedModels, selectionType])

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(260px,320px)_1fr]">
        <div className="space-y-3 rounded-[12px] border border-border bg-background p-4">
          <div>
            <div className="font-medium text-foreground text-sm">
              {t('settings.componentLab.modelSelector.configTitle')}
            </div>
            <div className="mt-1 text-muted-foreground text-xs">
              {t('settings.componentLab.modelSelector.configDescription')}
            </div>
          </div>

          <SettingRow>
            <SettingRowTitle>{t('settings.componentLab.modelSelector.multiple')}</SettingRowTitle>
            <Switch
              checked={multiple}
              data-testid="component-lab-model-selector-multiple-switch"
              onCheckedChange={setMultiple}
            />
          </SettingRow>

          <div className="space-y-1.5">
            <div className="text-muted-foreground text-xs">
              {t('settings.componentLab.modelSelector.selectionType')}
            </div>
            <RadioGroup
              className="grid grid-cols-2 gap-2"
              value={selectionType}
              onValueChange={(value) => setSelectionType(value as ModelSelectorSelectionType)}>
              <label
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-foreground text-xs transition-colors hover:bg-accent/40"
                data-testid="component-lab-model-selector-selection-type-model"
                htmlFor="component-lab-model-selector-selection-type-model-radio">
                <RadioGroupItem id="component-lab-model-selector-selection-type-model-radio" value="model" />
                <span>{t('settings.componentLab.modelSelector.selectionTypeModel')}</span>
              </label>
              <label
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-foreground text-xs transition-colors hover:bg-accent/40"
                data-testid="component-lab-model-selector-selection-type-id"
                htmlFor="component-lab-model-selector-selection-type-id-radio">
                <RadioGroupItem id="component-lab-model-selector-selection-type-id-radio" value="id" />
                <span>{t('settings.componentLab.modelSelector.selectionTypeId')}</span>
              </label>
            </RadioGroup>
          </div>

          <SettingDivider className="my-2" />

          <SettingRow>
            <SettingRowTitle>{t('settings.componentLab.modelSelector.showPinnedModels')}</SettingRowTitle>
            <Switch
              checked={showPinnedModels}
              data-testid="component-lab-model-selector-show-pinned-switch"
              onCheckedChange={setShowPinnedModels}
            />
          </SettingRow>

          <SettingRow>
            <SettingRowTitle>{t('settings.componentLab.modelSelector.showTagFilter')}</SettingRowTitle>
            <Switch
              checked={showTagFilter}
              data-testid="component-lab-model-selector-show-tag-filter-switch"
              onCheckedChange={setShowTagFilter}
            />
          </SettingRow>
        </div>

        <div className="flex flex-col gap-3 rounded-[12px] border border-border bg-background p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-medium text-foreground text-sm">
                {t('settings.componentLab.modelSelector.title')}
              </div>
              <div className="mt-1 text-muted-foreground text-xs">
                {t('settings.componentLab.modelSelector.description')}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setSelectedIds([])}>
              {t('settings.componentLab.modelSelector.clearSelection')}
            </Button>
          </div>

          {renderSelector()}

          {!hasModels && (
            <div className="text-muted-foreground text-xs">
              {isLoading
                ? t('settings.componentLab.modelSelector.loading')
                : t('settings.componentLab.modelSelector.empty')}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <DebugPanel
          testId="component-lab-model-selector-props-output"
          title={t('settings.componentLab.modelSelector.currentProps')}
          value={formatSnapshot(currentProps)}
        />
        <DebugPanel
          testId="component-lab-model-selector-value-output"
          title={t('settings.componentLab.modelSelector.valueProp')}
          value={formatSnapshot(currentValue)}
        />
        <DebugPanel
          testId="component-lab-model-selector-select-output"
          title={t('settings.componentLab.modelSelector.lastSelectReturn')}
          value={hasLastReturn ? formatSnapshot(lastReturn) : undefined}
        />
      </div>
    </div>
  )
}

export default ComponentLabModelSelectorSettings
