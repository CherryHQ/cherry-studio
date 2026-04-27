import { Button, Checkbox } from '@cherrystudio/ui'
import type { ModelSyncMissingAction } from '@shared/data/api/schemas/providers'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { AlertTriangle, CheckCircle2, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { modelSyncClasses } from '../components/ProviderSettingsPrimitives'
import type { ModelSyncPreviewResponse } from './modelSyncPreviewTypes'
import ModelSyncReferenceImpact from './ModelSyncReferenceImpact'

interface ModelSyncPreviewPanelProps {
  preview: ModelSyncPreviewResponse
  selectedAddedIds: Set<UniqueModelId>
  selectedMissingActions: Map<UniqueModelId, ModelSyncMissingAction>
  isApplying: boolean
  onToggleAdded: (uniqueModelId: UniqueModelId) => void
  onToggleMissing: (uniqueModelId: UniqueModelId) => void
  onToggleMissingAction: (uniqueModelId: UniqueModelId) => void
  onToggleAllAdded: () => void
  onToggleAllMissing: () => void
  onApply: () => void
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
export default function ModelSyncPreviewPanel({
  preview,
  selectedAddedIds,
  selectedMissingActions,
  isApplying,
  onToggleAdded,
  onToggleMissing,
  onToggleMissingAction,
  onToggleAllAdded,
  onToggleAllMissing,
  onApply,
  onCancel
}: ModelSyncPreviewPanelProps) {
  const { t } = useTranslation()

  const totalSelected = selectedAddedIds.size + selectedMissingActions.size
  const hasNew = preview.added.length > 0
  const hasMissing = preview.missing.length > 0
  const hasChanges = hasNew || hasMissing
  const allAddedSelected = hasNew && selectedAddedIds.size === preview.added.length
  const allMissingSelected = hasMissing && selectedMissingActions.size === preview.missing.length

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
                size="sm"
                disabled={isApplying}
                className={modelSyncClasses.fetchGhostAll}
                onClick={onToggleAllAdded}>
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
                    onClick={() => onToggleAdded(model.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onToggleAdded(model.id)
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
                        onCheckedChange={() => onToggleAdded(model.id)}
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
                size="sm"
                disabled={isApplying}
                className={modelSyncClasses.fetchGhostAllRemoved}
                onClick={onToggleAllMissing}>
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
                  const checked = selectedMissingActions.has(item.model.id)
                  const action = selectedMissingActions.get(item.model.id) ?? item.defaultAction
                  return (
                    <div key={item.model.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        className={modelSyncClasses.fetchRowRemoved}
                        data-checked={checked}
                        onClick={() => onToggleMissing(item.model.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onToggleMissing(item.model.id)
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
                            onCheckedChange={() => onToggleMissing(item.model.id)}
                          />
                        </span>
                        <ModelGlyph model={item.model} />
                        <div className="min-w-0 flex-1">
                          <p className={modelSyncClasses.fetchRowTitleStrike}>{item.model.name}</p>
                          <p className={modelSyncClasses.fetchRowIdStrike}>
                            {modelIdLine(item.model.id, item.model.apiModelId)}
                          </p>
                        </div>
                      </div>
                      {checked && item.canDelete ? (
                        <div className="mt-1.5 ps-8">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isApplying}
                            className={modelSyncClasses.toggleButton}
                            onClick={() => onToggleMissingAction(item.model.id)}>
                            {action === 'delete'
                              ? t('settings.models.manage.sync_switch_to_deprecate')
                              : t('settings.models.manage.sync_switch_to_delete')}
                          </Button>
                        </div>
                      ) : null}
                      {item.strongReferenceCount > 0 || item.replacement || item.preferenceReferences.length > 0 ? (
                        <div className="mt-1.5 space-y-0.5 ps-8 text-[length:var(--font-size-caption)] text-muted-foreground/70">
                          <span>
                            {item.strongReferenceCount > 0
                              ? t('settings.models.manage.sync_references', { count: item.strongReferenceCount })
                              : t('settings.models.manage.sync_no_references')}
                            {action === 'delete'
                              ? ` · ${t('common.delete')}`
                              : ` · ${t('settings.models.manage.sync_will_deprecate')}`}
                            {item.replacement
                              ? ` · ${t('settings.models.manage.sync_replacement', {
                                  model: parseUniqueModelId(item.replacement).modelId
                                })}`
                              : ''}
                          </span>
                          {item.preferenceReferences.length > 0 ? (
                            <div className="break-all text-muted-foreground/60">
                              {item.preferenceReferences.join(', ')}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ) : null}

        {preview.referenceSummary.items.length > 0 ? (
          <div className="border-[color:var(--section-border)] border-t pt-3">
            <ModelSyncReferenceImpact summary={preview.referenceSummary} />
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
                  selected: selectedMissingActions.size,
                  total: preview.missing.length
                })}
              </span>
            ) : null}
          </div>
          <div className={modelSyncClasses.fetchFooterActions}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isApplying}
              className={modelSyncClasses.fetchFooterBtn}
              onClick={onCancel}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isApplying || totalSelected === 0}
              className={modelSyncClasses.fetchFooterBtn}
              onClick={onApply}>
              {t('settings.models.manage.sync_apply_changes')}
            </Button>
          </div>
        </div>
      ) : (
        <div className={modelSyncClasses.fetchFooter}>
          <Button
            type="button"
            size="sm"
            className={modelSyncClasses.fetchOkBtn}
            disabled={isApplying}
            onClick={onCancel}>
            {t('settings.models.manage.fetch_ok')}
          </Button>
        </div>
      )}
    </div>
  )
}
