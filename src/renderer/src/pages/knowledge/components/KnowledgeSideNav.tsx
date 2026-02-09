import { Button } from '@cherrystudio/ui'
import Scrollbar from '@renderer/components/Scrollbar'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { Book, Plus, Trash2 } from 'lucide-react'
import { type FC, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { useKnowledgeBaseCtx, useKnowledgeUICtx } from '../context'

const KnowledgeSideNav: FC = () => {
  const { t } = useTranslation()
  const { bases, selectedBaseId, selectBase, deleteBase } = useKnowledgeBaseCtx()
  const { openAddDialog } = useKnowledgeUICtx()

  const handleDelete = useCallback(
    (base: KnowledgeBase) => {
      window.modal.confirm({
        title: t('knowledge.delete_confirm'),
        centered: true,
        onOk: async () => {
          selectBase(undefined)
          await deleteBase(base.id)
        }
      })
    },
    [deleteBase, t, selectBase]
  )

  return (
    <Scrollbar className="flex w-(--settings-width) min-w-(--settings-width) shrink-0 flex-col gap-2 border-border border-r px-2.5 py-3">
      {bases.map((base) => (
        <div
          className={`group cursor-pointer rounded-3xs pl-3 hover:opacity-70 ${
            selectedBaseId === base.id ? 'bg-foreground/5' : ''
          }`}
          key={base.id}
          onClick={() => selectBase(base.id)}>
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
      <Button variant="outline" className="h-7 rounded-3xs" onClick={openAddDialog}>
        <Plus size={14} className="text-primary" />
        {t('button.add')}
      </Button>
    </Scrollbar>
  )
}

export default KnowledgeSideNav
