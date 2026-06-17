import { Checkbox, Scrollbar, Table, TableBody, TableHead, TableHeader, TableRow } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { useTranslation } from 'react-i18next'

import KnowledgeItemRow from './KnowledgeItemRow'
import { knowledgeDataSourceCheckboxClassName } from './styles'

export interface KnowledgeItemListProps {
  items: KnowledgeItem[]
  isLoading: boolean
  selectedIds: Set<string>
  onToggleOne: (itemId: string, next: boolean) => void
  onToggleAll: (next: boolean) => void
  onItemClick: (itemId: string) => void
  onDelete: (item: KnowledgeItem) => void | Promise<unknown>
  onPreviewSource: (item: KnowledgeItem) => void | Promise<unknown>
  onReindex: (item: KnowledgeItem) => void | Promise<unknown>
  onViewChunks: (itemId: string) => void
}

const KnowledgeItemList = ({
  items,
  isLoading,
  selectedIds,
  onToggleOne,
  onToggleAll,
  onItemClick,
  onDelete,
  onPreviewSource,
  onReindex,
  onViewChunks
}: KnowledgeItemListProps) => {
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-foreground-muted text-sm">
        {t('common.loading')}
      </div>
    )
  }

  if (items.length === 0) {
    return null
  }

  const allSelected = items.every((item) => selectedIds.has(item.id))
  const someSelected = !allSelected && items.some((item) => selectedIds.has(item.id))

  return (
    <Scrollbar className={cn('min-h-0 flex-1 px-3 pb-6', '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden')}>
      <Table className="table-fixed border-separate border-spacing-x-0 border-spacing-y-1.5 text-sm">
        <colgroup>
          <col className="w-10" />
          <col />
          <col className="w-24" />
          <col className="w-32" />
          <col className="w-32" />
          <col className="w-12" />
        </colgroup>
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow className="hover:bg-transparent [&>th]:border-border-muted [&>th]:border-b [&>th]:py-0">
            <TableHead className="w-10 px-3">
              <div className="flex h-10 items-center">
                <Checkbox
                  size="sm"
                  className={knowledgeDataSourceCheckboxClassName}
                  aria-label={t('knowledge.data_source.table.select_all')}
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={(checked) => onToggleAll(checked === true)}
                />
              </div>
            </TableHead>
            <TableHead className="font-medium text-foreground-muted text-xs">
              <div className="flex h-10 min-w-0 items-center">
                <span>{t('knowledge.data_source.table.columns.name')}</span>
              </div>
            </TableHead>
            <TableHead className="w-24 font-medium text-foreground-muted text-xs">
              <div className="flex h-10 items-center">{t('knowledge.data_source.table.columns.type')}</div>
            </TableHead>
            <TableHead className="w-32 font-medium text-foreground-muted text-xs">
              <div className="flex h-10 items-center">{t('knowledge.data_source.table.columns.status')}</div>
            </TableHead>
            <TableHead className="w-32 font-medium text-foreground-muted text-xs">
              <div className="flex h-10 items-center">{t('knowledge.data_source.table.columns.updated_at')}</div>
            </TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <KnowledgeItemRow
              key={item.id}
              item={item}
              selected={selectedIds.has(item.id)}
              onToggleSelect={(next) => onToggleOne(item.id, next)}
              onClick={() => onItemClick(item.id)}
              onDelete={() => onDelete(item)}
              onPreviewSource={() => onPreviewSource(item)}
              onReindex={() => onReindex(item)}
              onViewChunks={() => onViewChunks(item.id)}
            />
          ))}
        </TableBody>
      </Table>
    </Scrollbar>
  )
}

export default KnowledgeItemList
