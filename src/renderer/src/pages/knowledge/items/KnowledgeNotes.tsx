import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import RichEditPopup from '@renderer/components/Popups/RichEditPopup'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { useKnowledgeItems } from '@renderer/data/hooks/useKnowledges'
import { useKnowledgeItemDelete, useKnowledgeNotes } from '@renderer/hooks/useKnowledge.v2'
import FileItem from '@renderer/pages/files/FileItem'
import { getProviderName } from '@renderer/services/ProviderService'
import type { KnowledgeBase, KnowledgeItem, ProcessingStatus } from '@renderer/types'
import { isMarkdownContent, markdownToPreviewText } from '@renderer/utils/markdownConverter'
import type { ItemStatus, KnowledgeItem as KnowledgeItemV2, NoteItemData } from '@shared/data/types/knowledge'
import dayjs from 'dayjs'
import { PlusIcon } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
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

/**
 * Map v2 ItemStatus to v1 ProcessingStatus
 */
const mapV2StatusToV1 = (status: ItemStatus): ProcessingStatus => {
  const statusMap: Record<ItemStatus, ProcessingStatus> = {
    idle: 'pending',
    pending: 'pending',
    preprocessing: 'processing',
    embedding: 'processing',
    completed: 'completed',
    failed: 'failed'
  }
  return statusMap[status] ?? 'pending'
}

/**
 * Convert v2 KnowledgeItem (note type) to v1 format for UI compatibility
 */
const toV1NoteItem = (item: KnowledgeItemV2): KnowledgeItem => {
  const data = item.data as NoteItemData
  return {
    id: item.id,
    type: item.type,
    content: data.content,
    created_at: Date.parse(item.createdAt),
    updated_at: Date.parse(item.updatedAt),
    processingStatus: mapV2StatusToV1(item.status),
    processingProgress: 0,
    processingError: item.error ?? '',
    retryCount: 0,
    uniqueId: item.status === 'completed' ? item.id : undefined
  }
}

interface KnowledgeContentProps {
  selectedBase: KnowledgeBase
}

const getDisplayTime = (item: KnowledgeItem) => {
  const timestamp = item.updated_at && item.updated_at > item.created_at ? item.updated_at : item.created_at
  return dayjs(timestamp).format('MM-DD HH:mm')
}

const KnowledgeNotes: FC<KnowledgeContentProps> = ({ selectedBase }) => {
  const { t } = useTranslation()

  // v2 Data API: Fetch items with smart polling
  const {
    items: v2Items,
    hasProcessingItems,
    mutate
  } = useKnowledgeItems(selectedBase.id || '', {
    enabled: !!selectedBase.id
  })

  // Convert v2 items to v1 format and filter by type 'note'
  const noteItems = useMemo(() => {
    return v2Items.filter((item) => item.type === 'note').map(toV1NoteItem)
  }, [v2Items])

  // Create a map of item statuses for getProcessingStatus
  const statusMap = useMemo(() => {
    const map = new Map<string, ProcessingStatus>()
    v2Items.forEach((item) => {
      const v1Status = mapV2StatusToV1(item.status)
      if (item.status !== 'completed') {
        map.set(item.id, v1Status)
      }
    })
    return map
  }, [v2Items])

  // Create a fake base object with items for StatusIcon compatibility
  const baseWithItems = useMemo(() => {
    return {
      ...selectedBase,
      items: noteItems
    }
  }, [selectedBase, noteItems])

  // getProcessingStatus function for StatusIcon
  const getProcessingStatus = useCallback(
    (sourceId: string): ProcessingStatus | undefined => {
      return statusMap.get(sourceId)
    },
    [statusMap]
  )

  // v2 Data API hook for adding notes
  const { addNote, isAddingNote } = useKnowledgeNotes(selectedBase.id || '')

  // v2 Data API hook for deleting items
  const { deleteItem } = useKnowledgeItemDelete()

  // v2 Data API hook for updating note content
  const { trigger: updateNoteApi } = useMutation('PATCH', `/knowledges/:id` as any)

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
        // Refresh the items list
        mutate()
        logger.info('Note content updated', { noteId })
      } catch (error) {
        logger.error('Failed to update note content', error as Error, { noteId })
        throw error
      }
    },
    [updateNoteApi, mutate]
  )

  const providerName = getProviderName(selectedBase?.model)
  const disabled = !selectedBase?.version || !providerName

  const reversedItems = useMemo(() => [...noteItems].reverse(), [noteItems])
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

  const handleEditNote = async (note: any) => {
    if (disabled) {
      return
    }

    const editedText = await RichEditPopup.show({
      content: note.content as string,
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
          {(note) => (
            <FileItem
              key={note.id}
              fileInfo={{
                name: (
                  <NotePreview onClick={() => handleEditNote(note)}>
                    {markdownToPreviewText(note.content as string, 50)}
                  </NotePreview>
                ),
                ext: isMarkdownContent(note.content as string) ? '.md' : '.txt',
                extra: getDisplayTime(note),
                actions: (
                  <FlexAlignCenter>
                    <Button variant="ghost" onClick={() => handleEditNote(note)}>
                      <EditIcon size={14} />
                    </Button>
                    <StatusIconWrapper>
                      <StatusIcon
                        sourceId={note.id}
                        base={baseWithItems}
                        getProcessingStatus={getProcessingStatus}
                        type="note"
                      />
                    </StatusIconWrapper>
                    <Button variant="ghost" onClick={() => deleteItem(selectedBase.id, note.id)}>
                      <DeleteIcon size={14} className="lucide-custom" style={{ color: 'var(--color-error)' }} />
                    </Button>
                  </FlexAlignCenter>
                )
              }}
            />
          )}
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
