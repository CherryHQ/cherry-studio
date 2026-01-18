import { Button } from '@cherrystudio/ui'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { Pencil, RotateCw, Trash2 } from 'lucide-react'
import type { FC } from 'react'

import { StatusIcon } from './StatusIcon'

interface KnowledgeItemActionsProps {
  item: KnowledgeItem
  onRefresh?: (id: string) => void
  onDelete: (id: string) => void
  onEdit?: () => void
}

export const KnowledgeItemActions: FC<KnowledgeItemActionsProps> = ({ item, onRefresh, onDelete, onEdit }) => {
  const showRefresh = onRefresh && (item.status === 'completed' || item.status === 'failed')

  return (
    <div className="flex items-center">
      <StatusIcon item={item} />
      {onEdit && (
        <Button size="icon-sm" variant="ghost" onClick={onEdit}>
          <Pencil size={16} className="text-foreground" />
        </Button>
      )}
      {showRefresh && (
        <Button size="icon-sm" variant="ghost" onClick={() => onRefresh(item.id)}>
          <RotateCw size={16} className="text-foreground" />
        </Button>
      )}
      <Button size="icon-sm" variant="ghost" onClick={() => onDelete(item.id)}>
        <Trash2 size={16} className="text-red-600" />
      </Button>
    </div>
  )
}
