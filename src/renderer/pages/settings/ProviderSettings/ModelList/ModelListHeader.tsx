import { Tooltip } from '@cherrystudio/ui'
import { FileText, Search, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'

export interface ModelListHeaderProps {
  isBusy: boolean
  hasNoModels: boolean
  searchText: string
  setSearchText: (text: string) => void
  docsWebsite?: string
  modelsWebsite?: string
  actions?: React.ReactNode
}

const ModelListHeader: React.FC<ModelListHeaderProps> = ({
  isBusy,
  searchText,
  setSearchText,
  docsWebsite,
  modelsWebsite,
  actions
}) => {
  const { t } = useTranslation()
  const docsLink = modelsWebsite || docsWebsite
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const isSearchExpanded = searchOpen || Boolean(searchText)

  useEffect(() => {
    if (isSearchExpanded) {
      searchInputRef.current?.focus()
    }
  }, [isSearchExpanded])

  return (
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
      </div>
      <div className={modelListClasses.headerInlineActions}>
        <div className={modelListClasses.titleActions}>{actions}</div>
      </div>
    </div>
  )
}

export default ModelListHeader
