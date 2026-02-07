import { Button } from '@cherrystudio/ui'
import Scrollbar from '@renderer/components/Scrollbar'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { Book, Plus, Trash2 } from 'lucide-react'
import { type FC, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

interface KnowledgeSideNavProps {
  bases: KnowledgeBase[]
  selectedBaseId?: string
  onSelect: (baseId?: string) => void
  onAdd: () => void
  deleteKnowledgeBase: (id: string) => Promise<void>
}

const KnowledgeSideNav: FC<KnowledgeSideNavProps> = ({
  bases,
  selectedBaseId,
  onSelect,
  onAdd,
  deleteKnowledgeBase
}) => {
  const { t } = useTranslation()

  const handleDelete = useCallback(
    (base: KnowledgeBase) => {
      window.modal.confirm({
        title: t('knowledge.delete_confirm'),
        centered: true,
        onOk: async () => {
          onSelect(undefined)
          await deleteKnowledgeBase(base.id)
        }
      })
    },
    [deleteKnowledgeBase, t, onSelect]
  )

  return (
    <Scrollbar className="flex w-(--settings-width) min-w-(--settings-width) shrink-0 flex-col gap-2 border-border border-r px-2.5 py-3">
      {bases.map((base) => (
        <div
          className={`group cursor-pointer rounded-3xs pl-3 hover:opacity-70 ${
            selectedBaseId === base.id ? 'bg-foreground/5' : ''
          }`}
          key={base.id}
          onClick={() => onSelect(base.id)}>
          <div className="flex flex-row items-center justify-between">
            <div className="flex flex-row items-center gap-2 text-[13px]">
              <Book size={16} />
              {base.name}
            </div>
            <div className="opacity-0 transition-opacity group-hover:opacity-100">
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDelete(base)
                }}>
                <Trash2 className="text-red-600" size={14} />
              </Button>
            </div>
          </div>
        </div>
      ))}
      <div className="flex cursor-pointer items-center gap-2 pl-3 hover:opacity-70" onClick={onAdd}>
        <Plus size={18} />
        {t('button.add')}
      </div>
    </Scrollbar>
  )
}

export default KnowledgeSideNav
