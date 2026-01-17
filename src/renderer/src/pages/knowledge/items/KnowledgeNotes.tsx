import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import RichEditPopup from '@renderer/components/Popups/RichEditPopup'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { useKnowledgeNotes } from '@renderer/hooks/useKnowledge.v2'
import FileItem from '@renderer/pages/files/FileItem'
import { getProviderName } from '@renderer/services/ProviderService'
import type { KnowledgeBase } from '@renderer/types'
import { isMarkdownContent, markdownToPreviewText } from '@renderer/utils/markdownConverter'
import type { KnowledgeItem as KnowledgeItemV2, NoteItemData } from '@shared/data/types/knowledge'
import { Pencil, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import StatusIcon from '../components/StatusIcon'
import { formatKnowledgeItemTime } from '../utils/time'

const logger = loggerService.withContext('KnowledgeNotes')

interface KnowledgeContentProps {
  selectedBase: KnowledgeBase
}

const KnowledgeNotes: FC<KnowledgeContentProps> = ({ selectedBase }) => {
  const { t } = useTranslation()

  // v2 Data API hook for note items
  const { noteItems, deleteItem } = useKnowledgeNotes(selectedBase.id || '')

  // v2 Data API hook for updating note content
  const itemsRefreshKey = selectedBase.id ? `/knowledges/${selectedBase.id}/items` : ''
  const { trigger: updateNoteApi } = useMutation('PATCH', `/knowledge-items/:id` as any, {
    refresh: itemsRefreshKey ? [itemsRefreshKey] : []
  })

  const updateNoteContent = useCallback(
    async (noteId: string, content: string) => {
      try {
        await updateNoteApi({
          params: { id: noteId },
          body: {
            data: {
              content
            } satisfies NoteItemData
          }
        } as any)
        logger.info('Note content updated', { noteId })
      } catch (error) {
        logger.error('Failed to update note content', error as Error, { noteId })
        throw error
      }
    },
    [updateNoteApi]
  )

  const providerName = getProviderName(selectedBase?.model)
  const disabled = !selectedBase?.version || !providerName

  const reversedItems = [...noteItems].reverse()
  const estimateSize = useCallback(() => 75, [])

  if (!selectedBase) {
    return null
  }

  const handleEditNote = async (note: KnowledgeItemV2) => {
    if (disabled) {
      return
    }

    const data = note.data as NoteItemData
    const editedText = await RichEditPopup.show({
      content: data.content,
      modalProps: {
        title: t('common.edit')
      }
    })
    editedText && updateNoteContent(note.id, editedText)
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2.5 px-4 py-5">
        {noteItems.length === 0 && <div className="text-center text-foreground-muted">{t('common.no_results')}</div>}
        <DynamicVirtualList
          list={reversedItems}
          estimateSize={estimateSize}
          overscan={2}
          scrollerStyle={{ paddingRight: 2 }}
          itemContainerStyle={{ paddingBottom: 10 }}
          autoHideScrollbar>
          {(note) => {
            const data = note.data as NoteItemData
            return (
              <FileItem
                key={note.id}
                fileInfo={{
                  name: (
                    <div className="cursor-pointer" onClick={() => handleEditNote(note)}>
                      {markdownToPreviewText(data.content, 50)}
                    </div>
                  ),
                  ext: isMarkdownContent(data.content) ? '.md' : '.txt',
                  extra: formatKnowledgeItemTime(note),
                  actions: (
                    <div className="flex items-center">
                      <Button size="icon-sm" variant="ghost" onClick={() => handleEditNote(note)}>
                        <Pencil size={16} className="text-foreground" />
                      </Button>
                      <Button size="icon-sm" variant="ghost">
                        <StatusIcon sourceId={note.id} item={note} type="note" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => deleteItem(note.id)}>
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

export default KnowledgeNotes
