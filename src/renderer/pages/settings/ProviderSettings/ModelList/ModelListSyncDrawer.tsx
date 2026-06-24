import { Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderSettingsDrawer from '../primitives/ProviderSettingsDrawer'
import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
import ModelSyncPreviewPanel, { ModelSyncPreviewFooter } from './ModelSyncPreviewPanel'
import type { ModelSyncPreviewResponse } from './modelSyncPreviewTypes'
import { type ModelPullApplyPayload, useModelListSyncSelections } from './useModelListSyncSelections'
import { filterProviderSettingModelsByKeywords } from './utils'

interface ModelListSyncDrawerProps {
  open: boolean
  preview: ModelSyncPreviewResponse | null
  isApplying: boolean
  onApply: (payload: ModelPullApplyPayload) => void | Promise<void>
  onClose: () => void
}

export default function ModelListSyncDrawer({ open, preview, isApplying, onApply, onClose }: ModelListSyncDrawerProps) {
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState('')
  const selections = useModelListSyncSelections(preview)
  const searchActive = Boolean(searchText.trim())
  const hasModels = !!preview && (preview.added.length > 0 || preview.missing.length > 0)

  useEffect(() => {
    setSearchText('')
  }, [open, preview])

  const filteredPreview = useMemo<ModelSyncPreviewResponse | null>(() => {
    if (!preview || !searchActive) {
      return preview
    }

    const added = filterProviderSettingModelsByKeywords(searchText, preview.added)
    const visibleMissingModels = filterProviderSettingModelsByKeywords(
      searchText,
      preview.missing.map((item) => item.model)
    )
    const visibleMissingIds = new Set(visibleMissingModels.map((model) => model.id))

    return {
      added,
      missing: preview.missing.filter((item) => visibleMissingIds.has(item.model.id))
    }
  }, [preview, searchActive, searchText])

  const handleApply = useCallback(() => {
    const payload = selections.getApplyPayload()
    if (!payload) {
      return
    }
    void onApply(payload)
  }, [selections, onApply])

  return (
    <ProviderSettingsDrawer
      open={open}
      onClose={onClose}
      title={t('settings.models.manage.fetch_result_title')}
      bodyClassName="pt-0"
      contentClassName="w-[min(calc(100vw-24px),520px)]"
      footer={
        preview ? (
          <ModelSyncPreviewFooter
            preview={preview}
            selections={selections}
            isApplying={isApplying}
            onApply={handleApply}
            onCancel={onClose}
          />
        ) : undefined
      }>
      {filteredPreview ? (
        <>
          {hasModels ? (
            <div className={modelListClasses.searchWrap}>
              <Search className={modelListClasses.searchIcon} />
              <input
                type="text"
                value={searchText}
                placeholder={t('models.search.placeholder')}
                disabled={isApplying}
                onChange={(event) => setSearchText(event.target.value)}
                className={modelListClasses.searchInput}
              />
              {searchText ? (
                <button
                  type="button"
                  onClick={() => setSearchText('')}
                  className={modelListClasses.searchClear}
                  aria-label={t('common.clear')}>
                  <X size={9} />
                </button>
              ) : null}
            </div>
          ) : null}
          <ModelSyncPreviewPanel
            preview={filteredPreview}
            selections={selections}
            isApplying={isApplying}
            searchActive={searchActive}
          />
        </>
      ) : null}
    </ProviderSettingsDrawer>
  )
}
