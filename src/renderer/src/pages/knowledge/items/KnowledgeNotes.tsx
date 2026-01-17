import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import RichEditPopup from '@renderer/components/Popups/RichEditPopup'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { useKnowledgeNotes } from '@renderer/hooks/useKnowledge.v2'
import { getProviderName } from '@renderer/services/ProviderService'
import type { KnowledgeBase } from '@renderer/types'
import { markdownToPreviewText } from '@renderer/utils/markdownConverter'
import type { KnowledgeItem as KnowledgeItemV2, NoteItemData } from '@shared/data/types/knowledge'
import { Notebook } from 'lucide-react'
import type { FC } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { KnowledgeItemActions } from '../components/KnowledgeItemActions'
import { KnowledgeItemList } from '../components/KnowledgeItemList'
import { KnowledgeItemRow } from '../components/KnowledgeItemRow'
import { formatKnowledgeItemTime } from '../utils/time'

const logger = loggerService.withContext('KnowledgeNotes')

interface KnowledgeContentProps {
  selectedBase: KnowledgeBase
}

const KnowledgeNotes: FC<KnowledgeContentProps> = ({ selectedBase }) => {
  const { t } = useTranslation()
  const { noteItems, deleteItem, refreshItem } = useKnowledgeNotes(selectedBase.id || '')

  const invalidateCache = useInvalidateCache()
  const itemsRefreshKey = selectedBase.id ? `/knowledge-bases/${selectedBase.id}/items` : ''

  const updateNoteContent = useCallback(
    async (noteId: string, content: string) => {
      try {
        await dataApiService.patch(`/knowledge-items/${noteId}`, {
          body: {
            data: { content } satisfies NoteItemData
          }
        })
        logger.info('Note content updated', { noteId })
        if (itemsRefreshKey) {
          await invalidateCache(itemsRefreshKey)
        }
      } catch (error) {
        logger.error('Failed to update note content', error as Error, { noteId })
        throw error
      }
    },
    [invalidateCache, itemsRefreshKey]
  )

  const providerName = getProviderName(selectedBase?.model)
  const disabled = !selectedBase?.version || !providerName

  const handleEditNote = async (note: KnowledgeItemV2) => {
    if (disabled) return

    const data = note.data as NoteItemData
    const editedText = await RichEditPopup.show({
      content: data.content,
      modalProps: { title: t('common.edit') }
    })
    editedText && updateNoteContent(note.id, editedText)
  }

  if (!selectedBase) {
    return null
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2.5 px-4 py-5">
        <KnowledgeItemList
          items={noteItems}
          renderItem={(note) => {
            const data = note.data as NoteItemData
            return (
              <KnowledgeItemRow
                icon={<Notebook size={18} className="text-foreground" />}
                content={<div onClick={() => handleEditNote(note)}>{markdownToPreviewText(data.content, 50)}</div>}
                metadata={formatKnowledgeItemTime(note)}
                actions={
                  <KnowledgeItemActions
                    item={note}
                    onRefresh={refreshItem}
                    onDelete={deleteItem}
                    onEdit={() => handleEditNote(note)}
                  />
                }
              />
            )
          }}
        />
      </div>
    </div>
  )
}

export default KnowledgeNotes
