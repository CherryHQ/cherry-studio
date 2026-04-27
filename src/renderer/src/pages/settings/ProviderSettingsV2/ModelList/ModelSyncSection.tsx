import { Button } from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { modelSyncClasses } from '../components/ProviderSettingsPrimitives'

interface ModelSyncSectionProps {
  title: ReactNode
  description: ReactNode
  totalCount: number
  selectedCount: number
  allSelected: boolean
  disabled?: boolean
  children: ReactNode
  emptyState: ReactNode
  onToggleAll: () => void
}

export default function ModelSyncSection({
  title,
  description,
  totalCount,
  selectedCount,
  allSelected,
  disabled = false,
  children,
  emptyState,
  onToggleAll
}: ModelSyncSectionProps) {
  const { t } = useTranslation()

  return (
    <section className={modelSyncClasses.section}>
      <div className={modelSyncClasses.sectionHeader}>
        <div className={modelSyncClasses.sectionTitleWrap}>
          <div className={modelSyncClasses.sectionTitle}>{title}</div>
          <div className={modelSyncClasses.sectionMeta}>
            {description}
            {totalCount > 0
              ? ` · ${t('settings.models.manage.sync_selected_summary', { selected: selectedCount, total: totalCount })}`
              : ''}
          </div>
        </div>
        {totalCount > 0 ? (
          <div className={modelSyncClasses.sectionActions}>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              className={cn(modelSyncClasses.toggleButton)}
              onClick={onToggleAll}>
              {allSelected ? t('settings.models.manage.select_none') : t('common.select_all')}
            </Button>
          </div>
        ) : null}
      </div>
      {totalCount > 0 ? (
        <div className={modelSyncClasses.list}>{children}</div>
      ) : (
        <div className={modelSyncClasses.emptyState}>{emptyState}</div>
      )}
    </section>
  )
}
