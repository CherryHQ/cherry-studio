import { Button, Tooltip } from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import { Download, Eye, EyeOff, Filter, HeartPulse, Plus, Search, X } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../components/ProviderSettingsPrimitives'
import ModelListCapabilityChips from './ModelListCapabilityChips'
import type { ModelListCapabilityCounts, ModelListCapabilityFilter } from './modelListDerivedState'

export interface ModelListHeaderProps {
  enabledModelCount: number
  modelCount: number
  hasVisibleModels: boolean
  allEnabled: boolean
  isBusy: boolean
  hasNoModels: boolean
  searchText: string
  setSearchText: (text: string) => void
  selectedCapabilityFilter: ModelListCapabilityFilter
  setSelectedCapabilityFilter: (filter: ModelListCapabilityFilter) => void
  capabilityOptions: readonly ModelListCapabilityFilter[]
  capabilityModelCounts: ModelListCapabilityCounts
  showDownloadButton: boolean
  onToggleVisibleModels: (enabled: boolean) => void
  onRunHealthCheck: () => void
  onRefreshModels: () => void
  onAddModel: () => void
  onOpenManageModels: () => void
  onDownloadModel: () => void
}

/**
 * Model list title + toolbar — structure matches `cherry-studio-ui-design` / `ModelServicePage.tsx`
 * (inline provider detail: toggles for search / capability filter, bulk visibility, health, pull + add; no separate manage).
 */
const ModelListHeader: React.FC<ModelListHeaderProps> = ({
  enabledModelCount,
  modelCount,
  hasVisibleModels,
  allEnabled,
  isBusy,
  hasNoModels,
  searchText,
  setSearchText,
  selectedCapabilityFilter,
  setSelectedCapabilityFilter,
  capabilityOptions,
  capabilityModelCounts,
  showDownloadButton,
  onToggleVisibleModels,
  onRunHealthCheck,
  onRefreshModels,
  onAddModel,
  onOpenManageModels,
  onDownloadModel
}) => {
  const { t } = useTranslation()
  const [showModelSearch, setShowModelSearch] = useState(true)
  const [showCapFilter, setShowCapFilter] = useState(false)
  const addModelClickTimeoutRef = useRef<number | null>(null)

  const toggleVisibleModelsLabel = allEnabled ? t('settings.models.bulk_disable') : t('settings.models.bulk_enable')
  const filterTooltip = showCapFilter
    ? t('settings.models.toolbar.filter_close')
    : t('settings.models.toolbar.filter_open')

  const onToggleSearch = useCallback(() => {
    setShowModelSearch((open) => {
      if (open) {
        setSearchText('')
      }
      return !open
    })
  }, [setSearchText])

  const onToggleCapFilter = useCallback(() => {
    setShowCapFilter((open) => {
      if (open) {
        setSelectedCapabilityFilter('all')
      }
      return !open
    })
  }, [setSelectedCapabilityFilter])

  useEffect(() => {
    return () => {
      if (addModelClickTimeoutRef.current !== null) {
        window.clearTimeout(addModelClickTimeoutRef.current)
      }
    }
  }, [])

  const onTriggerAddModel = useCallback(() => {
    if (addModelClickTimeoutRef.current !== null) {
      window.clearTimeout(addModelClickTimeoutRef.current)
    }

    addModelClickTimeoutRef.current = window.setTimeout(() => {
      addModelClickTimeoutRef.current = null
      onAddModel()
    }, 220)
  }, [onAddModel])

  const onTriggerManageModels = useCallback(() => {
    if (addModelClickTimeoutRef.current !== null) {
      window.clearTimeout(addModelClickTimeoutRef.current)
      addModelClickTimeoutRef.current = null
    }

    onOpenManageModels()
  }, [onOpenManageModels])

  return (
    <div className={modelListClasses.headerToolStack}>
      <div className={modelListClasses.titleRow}>
        <div className="min-w-0">
          <div className={modelListClasses.titleWrap}>
            <h2 className={modelListClasses.sectionTitle}>{t('settings.models.list_title')}</h2>
            <span className={modelListClasses.countMeta}>
              {enabledModelCount}/{modelCount} {t('common.enabled')}
            </span>
          </div>
        </div>
        <div className={modelListClasses.titleActions}>
          <Tooltip content={t('models.search.tooltip')}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('models.search.tooltip')}
              aria-expanded={showModelSearch}
              className={cn(
                modelListClasses.toolbarDesignIconTrigger,
                showModelSearch && modelListClasses.toolbarDesignIconTriggerOn
              )}
              disabled={isBusy}
              onClick={onToggleSearch}>
              <Search className={modelListClasses.toolbarDesignIcon} />
            </Button>
          </Tooltip>
          <Tooltip content={filterTooltip}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={filterTooltip}
              aria-expanded={showCapFilter}
              className={cn(
                modelListClasses.toolbarDesignIconTrigger,
                (showCapFilter || selectedCapabilityFilter !== 'all') && modelListClasses.toolbarDesignIconTriggerOn
              )}
              disabled={isBusy || hasNoModels}
              onClick={onToggleCapFilter}>
              <Filter className={modelListClasses.toolbarDesignIcon} />
            </Button>
          </Tooltip>
          <Tooltip content={toggleVisibleModelsLabel}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={toggleVisibleModelsLabel}
              className={cn(
                modelListClasses.toolbarDesignIconTrigger,
                allEnabled
                  ? 'hover:bg-destructive/[0.06] hover:text-destructive/80'
                  : 'hover:bg-[var(--color-surface-hover-soft)] hover:text-primary/90'
              )}
              disabled={!hasVisibleModels || isBusy}
              onClick={() => onToggleVisibleModels(!allEnabled)}>
              {allEnabled ? (
                <EyeOff className={modelListClasses.toolbarDesignIcon} />
              ) : (
                <Eye className={modelListClasses.toolbarDesignIcon} />
              )}
            </Button>
          </Tooltip>
          <Tooltip content={t('settings.models.check.button_caption')}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('settings.models.check.button_caption')}
              className={modelListClasses.toolbarDesignIconTrigger}
              disabled={!hasVisibleModels || isBusy}
              onClick={onRunHealthCheck}>
              <HeartPulse className={modelListClasses.toolbarDesignIcon} />
            </Button>
          </Tooltip>
          <div className={modelListClasses.toolbarOutlineActions}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(modelListClasses.fetchOutline, 'gap-1 px-2 py-[3px] text-xs')}
              disabled={isBusy}
              onClick={onRefreshModels}>
              <Download className={modelListClasses.toolbarDesignIcon} />
              <span>{t('settings.models.toolbar.pull_short')}</span>
            </Button>
            {!showDownloadButton ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn(modelListClasses.fetchOutline, 'gap-1 px-2 py-[3px] text-xs')}
                disabled={isBusy}
                aria-label={t('settings.models.add.add_model')}
                onClick={onTriggerAddModel}
                onDoubleClick={onTriggerManageModels}>
                <Plus className={modelListClasses.toolbarDesignIcon} />
                <span>{t('common.add')}</span>
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn(modelListClasses.fetchOutline, 'gap-1 px-2 py-[3px] text-xs')}
                disabled={isBusy}
                aria-label={t('button.download')}
                onClick={onDownloadModel}>
                <Plus className={modelListClasses.toolbarDesignIcon} />
                <span>{t('button.download')}</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      {showModelSearch ? (
        <div className={modelListClasses.searchExpandRow}>
          <div className={cn(modelListClasses.searchWrap, 'min-w-0 flex-1')}>
            <Search className={modelListClasses.searchIcon} />
            <input
              type="text"
              value={searchText}
              placeholder={t('models.search.placeholder')}
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
        </div>
      ) : null}

      {showCapFilter && !hasNoModels ? (
        <div className="mb-0.5">
          <ModelListCapabilityChips
            capabilityOptions={capabilityOptions}
            selectedCapabilityFilter={selectedCapabilityFilter}
            capabilityModelCounts={capabilityModelCounts}
            onSelectCapabilityFilter={setSelectedCapabilityFilter}
          />
        </div>
      ) : null}
    </div>
  )
}

export default ModelListHeader
