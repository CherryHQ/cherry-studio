import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import RichEditPopup from '@renderer/components/Popups/RichEditPopup'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { useKnowledgeNotes } from '@renderer/hooks/useKnowledge.v2'
import FileItem from '@renderer/pages/files/FileItem'
import { getProviderName } from '@renderer/services/ProviderService'
import type { KnowledgeBase } from '@renderer/types'
import { isMarkdownContent, markdownToPreviewText } from '@renderer/utils/markdownConverter'
import type { KnowledgeItem as KnowledgeItemV2, NoteItemData } from '@shared/data/types/knowledge'
import dayjs from 'dayjs'
import { PlusIcon } from 'lucide-react'
import type { FC } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import StatusIcon from '../components/StatusIcon'
import {
  FlexAlignCenter,
  ItemContainer,
  ItemHeader,
  KnowledgeEmptyView,
  ResponsiveButton,
  StatusIconWrapper
} from '../KnowledgeContent'

const logger = loggerService.withContext('KnowledgeNotes')

interface KnowledgeContentProps {
  selectedBase: KnowledgeBase
}

const getDisplayTime = (item: KnowledgeItemV2) => {
  const createdAt = Date.parse(item.createdAt)
  const updatedAt = Date.parse(item.updatedAt)
  const timestamp = updatedAt > createdAt ? updatedAt : createdAt
  return dayjs(timestamp).format('MM-DD HH:mm')
}

const KnowledgeNotes: FC<KnowledgeContentProps> = ({ selectedBase }) => {
  const { t } = useTranslation()

  // v2 Data API hook for note items
  const { noteItems, hasProcessingItems, addNote, isAddingNote, deleteItem } = useKnowledgeNotes(selectedBase.id || '')

  // v2 Data API hook for updating note content
  const itemsRefreshKey = selectedBase.id ? `/knowledge-bases/${selectedBase.id}/items` : ''
  const { trigger: updateNoteApi } = useMutation('PATCH', `/knowledges/:id` as any, {
    refresh: itemsRefreshKey ? [itemsRefreshKey] : []
  })

  const updateNoteContent = useCallback(
    async (noteId: string, content: string) => {
      try {
        await updateNoteApi({
          params: { id: noteId },
          body: {
            data: {
              type: 'note',
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

  const handleAddNote = async () => {
    if (disabled || isAddingNote) {
      return
    }

    const note = await RichEditPopup.show({
      content: '',
      modalProps: {
        title: t('knowledge.add_note')
      }
    })
    note && addNote(note)
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
    <ItemContainer>
      <ItemHeader>
        <ResponsiveButton variant="default" onClick={handleAddNote} disabled={disabled || isAddingNote}>
          <PlusIcon size={16} />
          {t('knowledge.add_note')}
        </ResponsiveButton>
        {hasProcessingItems && <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>同步中...</span>}
      </ItemHeader>
      <ItemFlexColumn>
        {noteItems.length === 0 && <KnowledgeEmptyView />}
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
                    <NotePreview onClick={() => handleEditNote(note)}>
                      {markdownToPreviewText(data.content, 50)}
                    </NotePreview>
                  ),
                  ext: isMarkdownContent(data.content) ? '.md' : '.txt',
                  extra: getDisplayTime(note),
                  actions: (
                    <FlexAlignCenter>
                      <Button variant="ghost" onClick={() => handleEditNote(note)}>
                        <EditIcon size={14} />
                      </Button>
                      <StatusIconWrapper>
                        <StatusIcon sourceId={note.id} item={note} type="note" />
                      </StatusIconWrapper>
                      <Button variant="ghost" onClick={() => deleteItem(note.id)}>
                        <DeleteIcon size={14} className="lucide-custom" style={{ color: 'var(--color-error)' }} />
                      </Button>
                    </FlexAlignCenter>
                  )
                }}
              />
            )
          }}
        </DynamicVirtualList>
      </ItemFlexColumn>
    </ItemContainer>
  )
}

const ItemFlexColumn = styled.div`
  padding: 20px 16px;
  height: calc(100vh - 135px);
`

const NotePreview = styled.span`
  cursor: pointer;
  color: var(--color-text-1);

  &:hover {
    color: var(--color-primary);
    text-decoration: underline;
  }
`

export default KnowledgeNotes
