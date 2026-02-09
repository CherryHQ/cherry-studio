import { useKnowledgeSitemaps } from '@renderer/hooks/useKnowledges'
import type { SitemapItemData } from '@shared/data/types/knowledge'
import { Globe } from 'lucide-react'
import type { FC } from 'react'

import {
  ItemDeleteAction,
  ItemRefreshAction,
  ItemStatusAction,
  KnowledgeItemActions
} from '../components/KnowledgeItemActions'
import { KnowledgeItemList } from '../components/KnowledgeItemList'
import { KnowledgeItemRow } from '../components/KnowledgeItemRow'
import { useKnowledgeBaseCtx } from '../context'
import { formatKnowledgeItemTime } from '../utils/time'

const KnowledgeSitemaps: FC = () => {
  const { selectedBase } = useKnowledgeBaseCtx()
  const { sitemapItems, deleteItem, refreshItem } = useKnowledgeSitemaps(selectedBase?.id ?? '')

  if (!selectedBase) {
    return null
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2.5 px-4 py-5">
        <KnowledgeItemList items={sitemapItems}>
          {(item) => {
            const data = item.data as SitemapItemData
            return (
              <KnowledgeItemRow
                icon={<Globe size={18} className="text-foreground" />}
                content={
                  <a href={data.url} target="_blank" rel="noopener noreferrer">
                    {data.url}
                  </a>
                }
                metadata={formatKnowledgeItemTime(item)}
                actions={
                  <KnowledgeItemActions>
                    <ItemStatusAction item={item} />
                    <ItemRefreshAction item={item} onRefresh={refreshItem} />
                    <ItemDeleteAction itemId={item.id} onDelete={deleteItem} />
                  </KnowledgeItemActions>
                }
              />
            )
          }}
        </KnowledgeItemList>
      </div>
    </div>
  )
}

export default KnowledgeSitemaps
