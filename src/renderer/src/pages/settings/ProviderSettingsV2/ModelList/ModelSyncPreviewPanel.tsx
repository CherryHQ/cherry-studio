import { Button, Checkbox } from '@cherrystudio/ui'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { AlertTriangle, CheckCircle2, Plus, Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import ModelTagsWithLabelV2 from '../components/ModelTagsWithLabelV2'
import type { ProviderSettingsDisplayModel } from '../config/models/types'
import { modelSyncClasses } from '../shared/primitives/ProviderSettingsPrimitives'
import type { ModelSyncPreviewResponse } from './modelSyncPreviewTypes'
import type { ModelPullApplyPayload } from './useModelListSyncSelections'
import { useModelListSyncSelections } from './useModelListSyncSelections'

interface ModelSyncPreviewPanelProps {
  preview: ModelSyncPreviewResponse
  isApplying: boolean
  onApply: (payload: ModelPullApplyPayload) => void | Promise<void>
  onCancel: () => void
}

function modelIdLine(uniqueModelId: UniqueModelId, apiModelId?: string) {
  return apiModelId ?? parseUniqueModelId(uniqueModelId).modelId
}

function ModelGlyph({ model }: { model: Model }) {
  const letter = (model.name || model.apiModelId || '?').slice(0, 1).toUpperCase()
  return <div className={modelSyncClasses.fetchAvatar}>{letter}</div>
}

/**
 * Pull preview — layout aligned with `cherry-studio-ui-design` `ModelServicePage` `FetchResultPanel`.
 */
export default function ModelSyncPreviewPanel({ preview, isApplying, onApply, onCancel }: ModelSyncPreviewPanelProps) {
  const { t } = useTranslation()

  const {
    selectedAddedIds,
    selectedMissingIds,
    toggleAddedSelection,
    toggleMissingSelection,
    toggleAllAdded,
    toggleAllMissing,
    totalSelected,
    allAddedSelected,
    allMissingSelected,
    getApplyPayload
  } = useModelListSyncSelections(preview)

  const handleApply = useCallback(() => {
    const payload = getApplyPayload()
    if (!payload) {
      return
    }
    void onApply(payload)
  }, [getApplyPayload, onApply])

  const hasNew = preview.added.length > 0
  const hasMissing = preview.missing.length > 0
  const hasChanges = hasNew || hasMissing

  return (
    <div className={modelSyncClasses.fetchRoot}>
      <div className={modelSyncClasses.fetchScroll}>
        {!hasChanges ? (
          <div className={modelSyncClasses.fetchEmpty}>
            <div className={modelSyncClasses.fetchEmptyIconWrap}>
              <CheckCircle2 className="size-4 text-muted-foreground/60" aria-hidden />
            </div>
            <p className="font-medium text-muted-foreground text-xs">{t('settings.models.manage.fetch_up_to_date')}</p>
            <p className="mt-1 text-muted-foreground/60 text-xs">{t('settings.models.manage.fetch_up_to_date_hint')}</p>
          </div>
        ) : null}

        {hasNew ? (
          <div>
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
            <div className="space-y-[2px]">
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
                        checked={checked}
                        disabled={isApplying}
                        className={modelSyncClasses.checkbox}
                        onCheckedChange={() => toggleAddedSelection(model.id)}
                      />
                    </span>
                    <ModelGlyph model={model} />
                    <div className="min-w-0 flex-1">
                      <p className={modelSyncClasses.fetchRowTitle}>{model.name}</p>
                      <p className={modelSyncClasses.fetchRowId}>{modelIdLine(model.id, model.apiModelId)}</p>
                    </div>
                    {model.contextWindow != null && model.contextWindow > 0 ? (
                      <span className="shrink-0 text-muted-foreground/60 text-xs">{model.contextWindow}</span>
                    ) : null}
                    <div className={modelSyncClasses.fetchCapabilityStrip}>
                      <ModelTagsWithLabelV2 model={model as ProviderSettingsDisplayModel} size={8} showLabel={false} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}

        {hasMissing ? (
          <div>
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
            <div className={modelSyncClasses.fetchRemovedShell}>
              <div className={modelSyncClasses.fetchRemovedHint}>
                <AlertTriangle className="mt-[1px] size-2.5 shrink-0 text-destructive/50" aria-hidden />
                <p className={modelSyncClasses.fetchMeta}>{t('settings.models.manage.fetch_removed_hint')}</p>
              </div>
              <div className="space-y-[2px]">
                {preview.missing.map((item) => {
                  const checked = selectedMissingIds.has(item.model.id)
                  return (
                    <div key={item.model.id}>
                      <div
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
                            checked={checked}
                            disabled={isApplying}
                            className={modelSyncClasses.checkbox}
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
                          <span className="shrink-0 text-muted-foreground/60 text-xs">{item.model.contextWindow}</span>
                        ) : null}
                        <div className={modelSyncClasses.fetchCapabilityStrip}>
                          <ModelTagsWithLabelV2
                            model={item.model as ProviderSettingsDisplayModel}
                            size={8}
                            showLabel={false}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {hasChanges ? (
        <div className={modelSyncClasses.fetchFooter}>
          <div className={modelSyncClasses.fetchFooterSummary}>
            {hasNew ? (
              <span className="inline-flex items-center gap-1">
                <Plus className="size-2 text-[var(--cherry-primary)]/60" aria-hidden />
                {t('settings.models.manage.fetch_summary_add', {
                  selected: selectedAddedIds.size,
                  total: preview.added.length
                })}
              </span>
            ) : null}
            {hasMissing ? (
              <span className="inline-flex items-center gap-1">
                <Trash2 className="size-2 text-destructive/60" aria-hidden />
                {t('settings.models.manage.fetch_summary_remove', {
                  selected: selectedMissingIds.size,
                  total: preview.missing.length
                })}
              </span>
            ) : null}
          </div>
          <div className={modelSyncClasses.fetchFooterActions}>
            <Button
              type="button"
              variant="outline"
              disabled={isApplying}
              className={modelSyncClasses.fetchFooterBtn}
              onClick={onCancel}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              disabled={isApplying || totalSelected === 0}
              className={modelSyncClasses.fetchFooterPrimary}
              onClick={handleApply}>
              {t('settings.models.manage.sync_apply_changes')}
            </Button>
          </div>
        </div>
      ) : (
        <div className={modelSyncClasses.fetchFooter}>
          <Button type="button" className={modelSyncClasses.fetchOkBtn} disabled={isApplying} onClick={onCancel}>
            {t('settings.models.manage.fetch_ok')}
          </Button>
        </div>
      )}
    </div>
  )
}
