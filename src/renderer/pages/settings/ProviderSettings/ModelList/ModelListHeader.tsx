import { Tooltip } from '@cherrystudio/ui'
import { ExternalLink, Search, X } from 'lucide-react'
import type React from 'react'
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

  return (
    <div className={modelListClasses.headerToolStack}>
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
                className={modelListClasses.titleHelpIconLink}>
                <ExternalLink className={modelListClasses.titleHelpIcon} aria-hidden />
              </a>
            </Tooltip>
          </div>
        ) : null}
      </div>
      <div className={modelListClasses.titleRow}>
        <div className="flex min-w-0 flex-1">
          <div className={modelListClasses.titleWrap}>
            <div className={modelListClasses.searchWrap}>
              <Search className={modelListClasses.searchIcon} />
              <input
                type="text"
                value={searchText}
                placeholder={t('models.search.placeholder')}
                disabled={isBusy}
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
        </div>
        <div className={modelListClasses.titleActions}>{actions}</div>
      </div>
    </div>
  )
}

export default ModelListHeader
