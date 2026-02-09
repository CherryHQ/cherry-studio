import { Button } from '@cherrystudio/ui'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { Pencil, RotateCw, Trash2 } from 'lucide-react'
import type { FC, ReactNode } from 'react'

import { StatusIcon } from './StatusIcon'

export const KnowledgeItemActions: FC<{ children: ReactNode }> = ({ children }) => {
  return <div className="flex items-center">{children}</div>
}

export const ItemStatusAction: FC<{ item: KnowledgeItem }> = ({ item }) => {
  return <StatusIcon item={item} />
}

export const ItemEditAction: FC<{ onClick: () => void }> = ({ onClick }) => {
  return (
    <Button size="icon-sm" variant="ghost" onClick={onClick}>
      <Pencil size={16} className="text-foreground" />
    </Button>
  )
}

export const ItemRefreshAction: FC<{ item: KnowledgeItem; onRefresh: (id: string) => void }> = ({
  item,
  onRefresh
}) => {
  if (item.status !== 'completed' && item.status !== 'failed') {
    return null
  }

  return (
    <Button size="icon-sm" variant="ghost" onClick={() => onRefresh(item.id)}>
      <RotateCw size={16} className="text-foreground" />
    </Button>
  )
}

export const ItemDeleteAction: FC<{ itemId: string; onDelete: (id: string) => void }> = ({ itemId, onDelete }) => {
  return (
    <Button size="icon-sm" variant="ghost" onClick={() => onDelete(itemId)}>
      <Trash2 size={16} className="text-red-600" />
    </Button>
  )
}
