import { Tooltip } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { ChevronsDownUp, ChevronsUpDown, FileText, Filter, Search, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
import type { ModelListCapabilityCounts, ModelListCapabilityFilter } from './modelListDerivedState'
import { ModelTypeFilterTabs } from './ModelTypeFilterTabs'

export interface ModelListHeaderProps {
  isBusy: boolean
  hasNoModels: boolean
  searchText: string
  setSearchText: (text: string) => void
  selectedTypeFilter: ModelListCapabilityFilter
  setSelectedTypeFilter: (filter: ModelListCapabilityFilter) => void
  typeCounts: ModelListCapabilityCounts
  groupsExpanded: boolean
  onToggleGroupsExpanded: () => void
  docsWebsite?: string
  modelsWebsite?: string
  actions?: React.ReactNode
}

const ModelListHeader: React.FC<ModelListHeaderProps> = ({
  isBusy,
  hasNoModels,
  searchText,
  setSearchText,
  selectedTypeFilter,
  setSelectedTypeFilter,
  typeCounts,
  groupsExpanded,
  onToggleGroupsExpanded,
  docsWebsite,
  modelsWebsite,
  actions
}) => {
  const { t } = useTranslation()
  const docsLink = modelsWebsite || docsWebsite
  const [searchOpen, setSearchOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const isSearchExpanded = searchOpen || Boolean(searchText)
  const isFilterActive = selectedTypeFilter !== 'all'
  const GroupExpansionIcon = groupsExpanded ? ChevronsDownUp : ChevronsUpDown

  useEffect(() => {
    if (isSearchExpanded) {
      searchInputRef.current?.focus()
    }
  }, [isSearchExpanded])

  return (
    <>
      <div className={modelListClasses.headerInlineRow}>
        <div className={modelListClasses.sectionTitleLine}>
          <h2 className={modelListClasses.sectionTitle}>{t('settings.models.list_title')}</h2>
          {docsLink ? (
            <div className={modelListClasses.titleHelpRow}>
              <Tooltip content={t('settings.models.docs')}>
                <a
                  target="_blank"
                  rel="noreferrer"
                  href={docsLink}
                  aria-label={t('settings.models.docs')}
                  className={modelListClasses.searchIconButton}>
                  <FileText className={modelListClasses.toolbarHeaderIcon} aria-hidden />
                </a>
              </Tooltip>
            </div>
          ) : null}
          <Tooltip content={t(groupsExpanded ? 'settings.models.collapse_all' : 'settings.models.expand_all')}>
            <button
              type="button"
              className={modelListClasses.groupToggleIconButton}
              aria-label={t(groupsExpanded ? 'settings.models.collapse_all' : 'settings.models.expand_all')}
              disabled={isBusy || hasNoModels}
              onClick={onToggleGroupsExpanded}>
              <GroupExpansionIcon className={modelListClasses.toolbarHeaderIcon} />
            </button>
          </Tooltip>
          {isSearchExpanded ? (
            <div className={modelListClasses.searchCompactWrap}>
              <Search className={modelListClasses.searchIcon} />
              <input
                ref={searchInputRef}
                type="text"
                value={searchText}
                placeholder={t('models.search.placeholder')}
                disabled={isBusy}
                onChange={(event) => setSearchText(event.target.value)}
                onFocus={() => setSearchOpen(true)}
                onBlur={() => {
                  if (!searchText) {
                    setSearchOpen(false)
                  }
                }}
                className={modelListClasses.searchInput}
              />
              {searchText ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchText('')
                    setSearchOpen(false)
                  }}
                  className={modelListClasses.searchClear}
                  aria-label={t('common.clear')}>
                  <X size={9} />
                </button>
              ) : null}
            </div>
          ) : (
            <Tooltip content={t('common.search')}>
              <button
                type="button"
                className={modelListClasses.searchIconButton}
                aria-label={t('common.search')}
                disabled={isBusy}
                onClick={() => setSearchOpen(true)}>
                <Search className={modelListClasses.toolbarHeaderIcon} />
              </button>
            </Tooltip>
          )}
          <Tooltip content={t('settings.models.filter.label')}>
            <button
              type="button"
              className={cn(
                modelListClasses.searchIconButton,
                (filterOpen || isFilterActive) && 'bg-accent/40 text-foreground'
              )}
              aria-label={t('settings.models.filter.label')}
              aria-pressed={filterOpen}
              disabled={isBusy || hasNoModels}
              onClick={() => setFilterOpen((open) => !open)}>
              <Filter className={modelListClasses.toolbarHeaderIcon} />
            </button>
          </Tooltip>
        </div>
        <div className={modelListClasses.headerInlineActions}>
          <div className={modelListClasses.titleActions}>{actions}</div>
        </div>
      </div>
      {filterOpen ? (
        <ModelTypeFilterTabs
          value={selectedTypeFilter}
          onValueChange={(next) => setSelectedTypeFilter(next as ModelListCapabilityFilter)}
          counts={typeCounts}
        />
      ) : null}
    </>
  )
}

export default ModelListHeader
