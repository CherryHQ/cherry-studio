import { useKnowledgeFiles } from '@renderer/hooks/useKnowledge'
import { formatFileSize } from '@renderer/utils'
import type { FileItemData, KnowledgeBase } from '@shared/data/types/knowledge'
import { Book } from 'lucide-react'
import type { FC } from 'react'

import { KnowledgeItemActions } from '../components/KnowledgeItemActions'
import { KnowledgeItemList } from '../components/KnowledgeItemList'
import { KnowledgeItemRow } from '../components/KnowledgeItemRow'
import { formatKnowledgeItemTime } from '../utils/time'

interface KnowledgeContentProps {
  selectedBase: KnowledgeBase
}

const KnowledgeFiles: FC<KnowledgeContentProps> = ({ selectedBase }) => {
  const { fileItems, deleteItem, refreshItem } = useKnowledgeFiles(selectedBase.id || '')

  if (!selectedBase) {
    return null
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2.5 px-4 py-5">
        <KnowledgeItemList
          items={fileItems}
          renderItem={(item) => {
            const file = (item.data as FileItemData).file
            return (
              <KnowledgeItemRow
                icon={<Book size={18} className="text-foreground" />}
                content={<div onClick={() => window.api.file.openFileWithRelativePath(file)}>{file.origin_name}</div>}
                metadata={`${formatKnowledgeItemTime(item)} · ${formatFileSize(file.size)}`}
                actions={<KnowledgeItemActions item={item} onRefresh={refreshItem} onDelete={deleteItem} />}
              />
            )
          }}
        />
      </div>
    </div>
  )
}

export default KnowledgeFiles
