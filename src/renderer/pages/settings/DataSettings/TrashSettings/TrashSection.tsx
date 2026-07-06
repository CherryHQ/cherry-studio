import { Button } from '@cherrystudio/ui'
import { SettingDivider, SettingGroup, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { Loader } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import TrashItemRow from './TrashItemRow'
import type { TrashItem } from './trashUtils'

export type TrashSectionPagination =
  | { kind: 'cursor'; hasMore: boolean; isLoadingMore: boolean; onLoadMore: () => void }
  | {
      kind: 'offset'
      page: number
      totalPages: number
      totalCount: number
      hasPrev: boolean
      hasNext: boolean
      onPrevPage: () => void
      onNextPage: () => void
    }

interface TrashSectionProps {
  title: string
  items: TrashItem[]
  isLoading: boolean
  error: Error | undefined
  onRetry: () => void
  pagination?: TrashSectionPagination
  retentionDays: number
  pendingRestoreId: string | null
  onRestore: (item: TrashItem) => void
  onDelete: (item: TrashItem) => void
}

const TrashSection: FC<TrashSectionProps> = ({
  title,
  items,
  isLoading,
  error,
  onRetry,
  pagination,
  retentionDays,
  pendingRestoreId,
  onRestore,
  onDelete
}) => {
  const { t } = useTranslation()

  // Offset pages expose the true trashed total; cursor sections only know what
  // has been loaded so far, so fall back to the loaded count there.
  const headerCount = pagination?.kind === 'offset' ? pagination.totalCount : items.length
  // Show offset prev/next whenever more than one page exists OR the user has
  // been stranded on a now-empty page past the first (so Prev remains reachable).
  const showOffsetControls = pagination?.kind === 'offset' && (pagination.totalPages > 1 || pagination.page > 1)

  return (
    <SettingGroup>
      <SettingTitle>
        <span>{title}</span>
        <span className="text-foreground-muted text-xs">{headerCount}</span>
      </SettingTitle>
      <SettingDivider />
      {isLoading ? (
        <div className="flex min-h-16 items-center justify-center">
          <Loader size={16} className="animate-spin text-foreground-muted" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2">
          <span className="text-destructive text-sm">{t('settings.data.trash.error.load')}</span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        </div>
      ) : (
        <>
          {items.length === 0 ? (
            <div className="text-foreground-muted text-sm">{t('settings.data.trash.empty.section')}</div>
          ) : (
            items.map((item) => (
              <TrashItemRow
                key={item.id}
                item={item}
                retentionDays={retentionDays}
                isRestoring={pendingRestoreId === item.id}
                onRestore={onRestore}
                onDelete={onDelete}
              />
            ))
          )}
          {pagination?.kind === 'cursor' && items.length > 0 && pagination.hasMore && (
            <div className="flex items-center justify-center">
              <Button variant="ghost" size="sm" loading={pagination.isLoadingMore} onClick={pagination.onLoadMore}>
                {t('settings.data.trash.load_more')}
              </Button>
            </div>
          )}
          {showOffsetControls && pagination?.kind === 'offset' && (
            <div className="flex items-center justify-center gap-2">
              <Button variant="ghost" size="sm" disabled={!pagination.hasPrev} onClick={pagination.onPrevPage}>
                {t('settings.data.trash.page_prev')}
              </Button>
              <span className="text-foreground-muted text-xs">
                {pagination.page}/{Math.max(pagination.totalPages, pagination.page)}
              </span>
              <Button variant="ghost" size="sm" disabled={!pagination.hasNext} onClick={pagination.onNextPage}>
                {t('settings.data.trash.page_next')}
              </Button>
            </div>
          )}
        </>
      )}
    </SettingGroup>
  )
}

export default TrashSection
