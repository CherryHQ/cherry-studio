import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@cherrystudio/ui'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { DraggableList } from '@renderer/components/DraggableList'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import ListItem from '@renderer/components/ListItem'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import Scrollbar from '@renderer/components/Scrollbar'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledge'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import KnowledgeSearchPopup from '@renderer/pages/knowledge/components/KnowledgeSearchPopup'
import type { KnowledgeBase } from '@renderer/types'
import { Book, Plus, Settings } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AddKnowledgeBasePopup from './components/AddKnowledgeBasePopup'
import EditKnowledgeBasePopup from './components/EditKnowledgeBasePopup'
import KnowledgeContent from './KnowledgeContent'

const KnowledgePage: FC = () => {
  const { t } = useTranslation()
  const { bases, renameKnowledgeBase, deleteKnowledgeBase, updateKnowledgeBases } = useKnowledgeBases()
  const [selectedBase, setSelectedBase] = useState<KnowledgeBase | undefined>(bases[0])
  const [isDragging, setIsDragging] = useState(false)
  const [contextMenuOpen, setContextMenuOpen] = useState<string | null>(null)

  const handleAddKnowledge = useCallback(async () => {
    const newBase = await AddKnowledgeBasePopup.show({ title: t('knowledge.add.title') })
    if (newBase) {
      setSelectedBase(newBase)
    }
  }, [t])

  const handleEditKnowledgeBase = useCallback(async (base: KnowledgeBase) => {
    const newBase = await EditKnowledgeBasePopup.show({ base })
    if (newBase && newBase?.id !== base.id) {
      setSelectedBase(newBase)
    }
  }, [])

  const handleRenameKnowledge = useCallback(
    async (base: KnowledgeBase) => {
      const name = await PromptPopup.show({
        title: t('knowledge.rename'),
        message: '',
        defaultValue: base.name || ''
      })
      if (name && base.name !== name) {
        renameKnowledgeBase(base.id, name)
      }
    },
    [renameKnowledgeBase, t]
  )

  const handleDeleteKnowledge = useCallback(
    (base: KnowledgeBase) => {
      window.modal.confirm({
        title: t('knowledge.delete_confirm'),
        centered: true,
        onOk: () => {
          setSelectedBase(undefined)
          deleteKnowledgeBase(base.id)
        }
      })
    },
    [deleteKnowledgeBase, t]
  )

  useEffect(() => {
    const hasSelectedBase = bases.find((base) => base.id === selectedBase?.id)
    !hasSelectedBase && setSelectedBase(bases[0])
  }, [bases, selectedBase])

  useShortcut('search_message', () => {
    if (selectedBase) {
      KnowledgeSearchPopup.show({ base: selectedBase }).then()
    }
  })

  return (
    <div className="flex flex-1 flex-col" style={{ height: 'calc(100vh - var(--navbar-height))' }}>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('knowledge.title')}</NavbarCenter>
      </Navbar>
      <div className="flex min-h-full flex-1 flex-row" id="content-container">
        <Scrollbar
          className="flex flex-col border-[var(--color-border)] border-r-[0.5px] p-[12px_10px]"
          style={{ width: 'calc(var(--settings-width) + 100px)' }}>
          <div className="mb-2">
            <DraggableList
              list={bases}
              onUpdate={updateKnowledgeBases}
              style={{ marginBottom: 0, paddingBottom: isDragging ? 50 : 0 }}
              onDragStart={() => setIsDragging(true)}
              onDragEnd={() => setIsDragging(false)}>
              {(base: KnowledgeBase) => (
                <DropdownMenu
                  key={base.id}
                  open={contextMenuOpen === base.id}
                  onOpenChange={(open) => setContextMenuOpen(open ? base.id : null)}>
                  <DropdownMenuTrigger asChild>
                    <div
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setContextMenuOpen(base.id)
                      }}>
                      <ListItem
                        active={selectedBase?.id === base.id}
                        icon={<Book size={16} />}
                        title={base.name}
                        onClick={() => setSelectedBase(base)}
                      />
                    </div>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => handleRenameKnowledge(base)}>
                      <EditIcon size={14} />
                      {t('knowledge.rename')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleEditKnowledgeBase(base)}>
                      <Settings size={14} />
                      {t('common.settings')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => handleDeleteKnowledge(base)}>
                      <DeleteIcon size={14} />
                      {t('common.delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </DraggableList>
          </div>
          {!isDragging && (
            <div
              className="relative mb-2 flex cursor-pointer flex-row justify-between border-[0.5px] border-transparent p-[7px_12px] hover:bg-[var(--color-background-soft)]"
              style={{ borderRadius: 'var(--list-item-border-radius)' }}
              onClick={handleAddKnowledge}>
              <div className="line-clamp-1 flex flex-row items-center gap-2 overflow-hidden text-[13px] text-[var(--color-text)]">
                <Plus size={18} />
                {t('button.add')}
              </div>
            </div>
          )}
          <div className="mb-0" style={{ minHeight: '10px' }}></div>
        </Scrollbar>
        {bases.length === 0 ? (
          <Scrollbar className="flex w-full flex-col p-[15px_20px] pb-[50px]">
            <div className="flex-1 text-center text-gray-400">{t('knowledge.empty')}</div>
          </Scrollbar>
        ) : selectedBase ? (
          <KnowledgeContent selectedBase={selectedBase} />
        ) : null}
      </div>
    </div>
  )
}

export default KnowledgePage
