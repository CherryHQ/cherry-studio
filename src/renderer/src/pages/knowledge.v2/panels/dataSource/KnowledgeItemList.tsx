import { Scrollbar } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { useTranslation } from 'react-i18next'

import KnowledgeItemRow from './KnowledgeItemRow'

export interface KnowledgeItemListProps {
  items: KnowledgeItem[]
  isLoading: boolean
  onItemClick: (item: KnowledgeItem) => void
}

const KnowledgeItemList = ({ items, isLoading, onItemClick }: KnowledgeItemListProps) => {
  const { t } = useTranslation()

  return (
    <Scrollbar className={cn('mx-2.5 mb-2.5 min-h-0 flex-1 rounded-lg border border-border/25')}>
      {isLoading ? (
        <div className="flex h-full items-center justify-center px-4 text-center text-[0.6875rem] text-muted-foreground/60">
          {t('common.loading')}
        </div>
      ) : items.length === 0 ? (
        <div className="flex h-full items-center justify-center px-4 text-center text-[0.6875rem] text-muted-foreground/60">
          {t('common.no_results')}
        </div>
      ) : (
        <div className="divide-y divide-border/15">
          {items.map((item) => (
            <KnowledgeItemRow key={item.id} item={item} onClick={() => onItemClick(item)} />
          ))}
        </div>
      )}
    </Scrollbar>
  )
}

export default KnowledgeItemList
