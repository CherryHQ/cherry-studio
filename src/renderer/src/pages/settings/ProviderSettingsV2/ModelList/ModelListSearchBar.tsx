import { Button } from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import { Download, Plus, Search, X } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../components/ProviderSettingsPrimitives'

interface ModelListSearchBarProps {
  showDownloadButton: boolean
  searchText: string
  isBusy: boolean
  onSearchTextChange: (text: string) => void
  onRefreshModels: () => void
  onAddModel: () => void
  onDownloadModel: () => void
}

const ModelListSearchBar: React.FC<ModelListSearchBarProps> = ({
  showDownloadButton,
  searchText,
  isBusy,
  onSearchTextChange,
  onRefreshModels,
  onAddModel,
  onDownloadModel
}) => {
  const { t } = useTranslation()

  return (
    <div className={modelListClasses.searchRow}>
      <div className={modelListClasses.searchWrap}>
        <Search className={modelListClasses.searchIcon} />
        <input
          type="text"
          value={searchText}
          placeholder={t('models.search.placeholder')}
          onChange={(event) => onSearchTextChange(event.target.value)}
          className={modelListClasses.searchInput}
        />
        {searchText && (
          <button type="button" onClick={() => onSearchTextChange('')} className={modelListClasses.searchClear}>
            <X size={9} />
          </button>
        )}
      </div>
      <div className={modelListClasses.searchActions}>
        <Button
          variant="outline"
          onClick={onRefreshModels}
          size="sm"
          className={cn(modelListClasses.fetchOutline, 'gap-1.5')}
          disabled={isBusy}>
          <Download className={modelListClasses.toolbarIcon} />
          {t('settings.models.manage.fetch_list')}
        </Button>
        {!showDownloadButton ? (
          <Button
            onClick={onAddModel}
            size="icon-sm"
            className={modelListClasses.addIconButton}
            disabled={isBusy}
            aria-label={t('settings.models.add.add_model')}>
            <Plus className={modelListClasses.toolbarIcon} />
          </Button>
        ) : (
          <Button
            onClick={onDownloadModel}
            size="icon-sm"
            className={modelListClasses.addIconButton}
            disabled={isBusy}
            aria-label={t('button.download')}>
            <Plus className={modelListClasses.toolbarIcon} />
          </Button>
        )}
      </div>
    </div>
  )
}

export default ModelListSearchBar
