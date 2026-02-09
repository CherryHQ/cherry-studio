import { useKnowledgeFiles } from '@renderer/hooks/useKnowledges'
import { formatFileSize } from '@renderer/utils'
import type { FileItemData } from '@shared/data/types/knowledge'
import { Book } from 'lucide-react'
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

const KnowledgeFiles: FC = () => {
  const { selectedBase } = useKnowledgeBaseCtx()
  const { fileItems, deleteItem, refreshItem } = useKnowledgeFiles(selectedBase?.id ?? '')

  if (!selectedBase) {
    return null
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2.5 px-4 py-5">
        <KnowledgeItemList items={fileItems}>
          {(item) => {
            const file = (item.data as FileItemData).file
            return (
              <KnowledgeItemRow
                icon={<Book size={18} className="text-foreground" />}
                content={<div onClick={() => window.api.file.openFileWithRelativePath(file)}>{file.origin_name}</div>}
                metadata={`${formatKnowledgeItemTime(item)} · ${formatFileSize(file.size)}`}
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

export default KnowledgeFiles
