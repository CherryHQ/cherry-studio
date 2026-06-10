import { Alert, Button, Checkbox } from '@cherrystudio/ui'
import { getModelLogo } from '@renderer/config/models'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { CheckCircle2, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import ModelTagsWithLabel, { type ModelTagsWithLabelModel } from '../components/ModelTagsWithLabel'
import { modelSyncClasses } from '../primitives/ProviderSettingsPrimitives'
import type { ModelSyncPreviewResponse } from './modelSyncPreviewTypes'
import type { useModelListSyncSelections } from './useModelListSyncSelections'

export type ModelSyncPreviewSelections = ReturnType<typeof useModelListSyncSelections>

interface ModelSyncPreviewPanelProps {
  preview: ModelSyncPreviewResponse
  selections: ModelSyncPreviewSelections
  isApplying: boolean
}

interface ModelSyncPreviewFooterProps {
  preview: ModelSyncPreviewResponse
  selections: ModelSyncPreviewSelections
  isApplying: boolean
  onApply: () => void
  onCancel: () => void
}

function modelIdLine(uniqueModelId: UniqueModelId, apiModelId?: string) {
  return apiModelId ?? parseUniqueModelId(uniqueModelId).modelId
}

function ModelGlyph({ model }: { model: Model }) {
  const Icon = getModelLogo(model)
  if (Icon) {
    return <Icon.Avatar size={20} />
  }
  const letter = (model.name || model.apiModelId || '?').slice(0, 1).toUpperCase()
  return <div className={modelSyncClasses.fetchAvatar}>{letter}</div>
}

export default function ModelSyncPreviewPanel({ preview, selections, isApplying }: ModelSyncPreviewPanelProps) {
  const { t } = useTranslation()
  const {
    selectedAddedIds,
    selectedMissingIds,
    toggleAddedSelection,
    toggleMissingSelection,
    toggleAllAdded,
    toggleAllMissing,
    allAddedSelected,
    allMissingSelected
  } = selections

  const hasNew = preview.added.length > 0
  const hasMissing = preview.missing.length > 0

  if (!hasNew && !hasMissing) {
    return (
      <div className={modelSyncClasses.fetchEmpty}>
        <div className={modelSyncClasses.fetchEmptyIconWrap}>
          <CheckCircle2 className={modelSyncClasses.fetchEmptyIcon} aria-hidden />
        </div>
        <p className={modelSyncClasses.fetchEmptyTitle}>{t('settings.models.manage.fetch_up_to_date')}</p>
        <p className={modelSyncClasses.fetchEmptyDescription}>{t('settings.models.manage.fetch_up_to_date_hint')}</p>
      </div>
    )
  }

  return (
    <>
      {hasNew ? (
        <section className={modelSyncClasses.fetchSection}>
          <div className={modelSyncClasses.fetchSectionHeader}>
            <div className={modelSyncClasses.fetchSectionTitleRow}>
              <div className={modelSyncClasses.fetchDotNew} aria-hidden />
              <span className={modelSyncClasses.fetchSectionTitle}>
                {t('settings.models.manage.sync_added_section')}
              </span>
              <span className={modelSyncClasses.fetchSectionCount}>({preview.added.length})</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              disabled={isApplying}
              className={modelSyncClasses.fetchGhostAll}
              onClick={toggleAllAdded}>
              {allAddedSelected
                ? t('settings.models.manage.fetch_deselect_all_add')
                : t('settings.models.manage.fetch_select_all_add')}
            </Button>
          </div>
          <div className={modelSyncClasses.fetchList}>
            {preview.added.map((model) => {
              const checked = selectedAddedIds.has(model.id)
              return (
                <div
                  key={model.id}
                  role="button"
                  tabIndex={0}
                  className={modelSyncClasses.fetchRowNew}
                  data-checked={checked}
                  onClick={() => toggleAddedSelection(model.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      toggleAddedSelection(model.id)
                    }
                  }}>
                  <span
                    className="shrink-0"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}>
                    <Checkbox
                      size="sm"
                      checked={checked}
                      disabled={isApplying}
                      onCheckedChange={() => toggleAddedSelection(model.id)}
                    />
                  </span>
                  <ModelGlyph model={model} />
                  <div className="min-w-0 flex-1">
                    <p className={modelSyncClasses.fetchRowTitle}>{model.name}</p>
                    <p className={modelSyncClasses.fetchRowId}>{modelIdLine(model.id, model.apiModelId)}</p>
                  </div>
                  {model.contextWindow != null && model.contextWindow > 0 ? (
                    <span className={modelSyncClasses.fetchContextValue}>{model.contextWindow}</span>
                  ) : null}
                  <div className={modelSyncClasses.fetchCapabilityStrip}>
                    <ModelTagsWithLabel model={model as ModelTagsWithLabelModel} size={8} />
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      {hasMissing ? (
        <section className={modelSyncClasses.fetchSection}>
          <div className={modelSyncClasses.fetchSectionHeader}>
            <div className={modelSyncClasses.fetchSectionTitleRow}>
              <div className={modelSyncClasses.fetchDotRemoved} aria-hidden />
              <span className={modelSyncClasses.fetchSectionTitle}>
                {t('settings.models.manage.sync_missing_section')}
              </span>
              <span className={modelSyncClasses.fetchSectionCount}>({preview.missing.length})</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              disabled={isApplying}
              className={modelSyncClasses.fetchGhostAllRemoved}
              onClick={toggleAllMissing}>
              {allMissingSelected
                ? t('settings.models.manage.fetch_deselect_all_remove')
                : t('settings.models.manage.fetch_select_all_remove')}
            </Button>
          </div>
          <Alert
            type="warning"
            showIcon
            message={t('settings.models.manage.fetch_removed_hint')}
            className={modelSyncClasses.fetchWarning}
          />
          <div className={modelSyncClasses.fetchList}>
            {preview.missing.map((item) => {
              const checked = selectedMissingIds.has(item.model.id)
              return (
                <div
                  key={item.model.id}
                  role="button"
                  tabIndex={0}
                  className={modelSyncClasses.fetchRowRemoved}
                  data-checked={checked}
                  onClick={() => toggleMissingSelection(item.model.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      toggleMissingSelection(item.model.id)
                    }
                  }}>
                  <span
                    className="shrink-0"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}>
                    <Checkbox
                      size="sm"
                      checked={checked}
                      disabled={isApplying}
                      onCheckedChange={() => toggleMissingSelection(item.model.id)}
                    />
                  </span>
                  <ModelGlyph model={item.model} />
                  <div className="min-w-0 flex-1">
                    <p className={modelSyncClasses.fetchRowTitleStrike}>{item.model.name}</p>
                    <p className={modelSyncClasses.fetchRowIdStrike}>
                      {modelIdLine(item.model.id, item.model.apiModelId)}
                    </p>
                  </div>
                  {item.model.contextWindow != null && item.model.contextWindow > 0 ? (
                    <span className={modelSyncClasses.fetchContextValue}>{item.model.contextWindow}</span>
                  ) : null}
                  <div className={modelSyncClasses.fetchCapabilityStrip}>
                    <ModelTagsWithLabel model={item.model as ModelTagsWithLabelModel} size={8} />
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}
    </>
  )
}

export function ModelSyncPreviewFooter({
  preview,
  selections,
  isApplying,
  onApply,
  onCancel
}: ModelSyncPreviewFooterProps) {
  const { t } = useTranslation()
  const { selectedAddedIds, selectedMissingIds, totalSelected } = selections

  const hasNew = preview.added.length > 0
  const hasMissing = preview.missing.length > 0

  if (!hasNew && !hasMissing) {
    return (
      <Button type="button" className="w-full" disabled={isApplying} onClick={onCancel}>
        {t('settings.models.manage.fetch_ok')}
      </Button>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 text-foreground-muted text-xs">
        {hasNew ? (
          <span className="inline-flex items-center gap-1">
            <Plus className="size-3 text-primary" aria-hidden />
            {t('settings.models.manage.fetch_summary_add', {
              selected: selectedAddedIds.size,
              total: preview.added.length
            })}
          </span>
        ) : null}
        {hasMissing ? (
          <span className="inline-flex items-center gap-1">
            <Trash2 className="size-3 text-destructive" aria-hidden />
            {t('settings.models.manage.fetch_summary_remove', {
              selected: selectedMissingIds.size,
              total: preview.missing.length
            })}
          </span>
        ) : null}
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" disabled={isApplying} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="button" disabled={isApplying || totalSelected === 0} loading={isApplying} onClick={onApply}>
          {t('settings.models.manage.sync_apply_changes')}
        </Button>
      </div>
    </>
  )
}
