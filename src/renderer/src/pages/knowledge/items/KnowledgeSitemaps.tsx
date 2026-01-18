import { useKnowledgeSitemaps } from '@renderer/hooks/useKnowledge.v2'
import type { KnowledgeBase, SitemapItemData } from '@shared/data/types/knowledge'
import { Globe } from 'lucide-react'
import type { FC } from 'react'

import { KnowledgeItemActions } from '../components/KnowledgeItemActions'
import { KnowledgeItemList } from '../components/KnowledgeItemList'
import { KnowledgeItemRow } from '../components/KnowledgeItemRow'
import { formatKnowledgeItemTime } from '../utils/time'

interface KnowledgeContentProps {
  selectedBase: KnowledgeBase
}

const KnowledgeSitemaps: FC<KnowledgeContentProps> = ({ selectedBase }) => {
  const { sitemapItems, deleteItem, refreshItem } = useKnowledgeSitemaps(selectedBase.id || '')

  if (!selectedBase) {
    return null
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2.5 px-4 py-5">
        <KnowledgeItemList
          items={sitemapItems}
          renderItem={(item) => {
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
                actions={<KnowledgeItemActions item={item} onRefresh={refreshItem} onDelete={deleteItem} />}
              />
            )
          }}
        />
      </div>
    </div>
  )
}

export default KnowledgeSitemaps
