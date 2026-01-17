import { Button, Tooltip } from '@cherrystudio/ui'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { useKnowledgeSitemaps } from '@renderer/hooks/useKnowledge.v2'
import FileItem from '@renderer/pages/files/FileItem'
import type { KnowledgeBase } from '@renderer/types'
import type { SitemapItemData } from '@shared/data/types/knowledge'
import { RotateCw, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import StatusIcon from '../components/StatusIcon'
import { formatKnowledgeItemTime } from '../utils/time'

interface KnowledgeContentProps {
  selectedBase: KnowledgeBase
}

const KnowledgeSitemaps: FC<KnowledgeContentProps> = ({ selectedBase }) => {
  // v2 Data API hook for sitemap items
  const { sitemapItems, deleteItem, refreshItem } = useKnowledgeSitemaps(selectedBase.id || '')
  const { t } = useTranslation()

  const reversedItems = [...sitemapItems].reverse()
  const estimateSize = useCallback(() => 75, [])

  if (!selectedBase) {
    return null
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2.5 px-4 py-5">
        {sitemapItems.length === 0 && <div className="text-center text-foreground-muted">{t('common.no_results')}</div>}
        <DynamicVirtualList
          list={reversedItems}
          estimateSize={estimateSize}
          overscan={2}
          scrollerStyle={{ paddingRight: 2 }}
          itemContainerStyle={{ paddingBottom: 10 }}
          autoHideScrollbar>
          {(item) => {
            const data = item.data as SitemapItemData
            return (
              <FileItem
                key={item.id}
                fileInfo={{
                  name: (
                    <Tooltip content={data.url}>
                      <a href={data.url} target="_blank" rel="noopener noreferrer">
                        {data.url}
                      </a>
                    </Tooltip>
                  ),
                  ext: '.sitemap',
                  extra: formatKnowledgeItemTime(item),
                  actions: (
                    <div className="flex items-center">
                      {item.status === 'completed' && (
                        <Button size="icon-sm" variant="ghost" onClick={() => refreshItem(item.id)}>
                          <RotateCw size={16} className="text-foreground" />
                        </Button>
                      )}
                      <Button size="icon-sm" variant="ghost">
                        <StatusIcon sourceId={item.id} item={item} type="sitemap" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => deleteItem(item.id)}>
                        <Trash2 size={16} className="text-red-600" />
                      </Button>
                    </div>
                  )
                }}
              />
            )
          }}
        </DynamicVirtualList>
      </div>
    </div>
  )
}

export default KnowledgeSitemaps
