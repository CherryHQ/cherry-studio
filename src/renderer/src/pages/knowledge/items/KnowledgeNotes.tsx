import { Button } from '@heroui/react'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import RichEditPopup from '@renderer/components/Popups/RichEditPopup'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { useKnowledge } from '@renderer/hooks/useKnowledge'
import FileItem from '@renderer/pages/files/FileItem'
import { getProviderName } from '@renderer/services/ProviderService'
import type { KnowledgeBase, KnowledgeItem } from '@renderer/types'
import { isMarkdownContent, markdownToPreviewText } from '@renderer/utils/markdownConverter'
import dayjs from 'dayjs'
import { PlusIcon } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import StatusIcon from '../components/StatusIcon'
import {
  FlexAlignCenter,
  ItemContainer,
  ItemHeader,
  KnowledgeEmptyView,
  StatusIconWrapper
} from '../KnowledgeContent'

interface KnowledgeContentProps {
  selectedBase: KnowledgeBase
}

const getDisplayTime = (item: KnowledgeItem) => {
  const timestamp = item.updated_at && item.updated_at > item.created_at ? item.updated_at : item.created_at
  return dayjs(timestamp).format('MM-DD HH:mm')
}

const KnowledgeNotes: FC<KnowledgeContentProps> = ({ selectedBase }) => {
  const { t } = useTranslation()

  const { base, noteItems, updateNoteContent, removeItem, getProcessingStatus, addNote } = useKnowledge(
    selectedBase.id || ''
  )

  const providerName = getProviderName(base?.model)
  const disabled = !base?.version || !providerName

  const reversedItems = useMemo(() => [...noteItems].reverse(), [noteItems])
  const estimateSize = useCallback(() => 75, [])

  if (!base) {
    return null
  }

  const handleAddNote = async () => {
    if (disabled) {
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
        <Button
          size='sm'
          color="primary"
          startContent={<PlusIcon size={16} />}
          onClick={(e) => {
            e.stopPropagation()
            handleAddNote()
          }}
          isDisabled={disabled}>
          {t('knowledge.add_note')}
        </Button>
      </ItemHeader>
      <div className="px-4 py-5 h-[calc(100vh-135px)]">
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
                  <span
                    className="cursor-pointer text-[var(--color-text-1)] hover:text-[var(--color-primary)] hover:underline"
                    onClick={() => handleEditNote(note)}>
                    {markdownToPreviewText(note.content as string, 50)}
                  </span>
                ),
                ext: isMarkdownContent(note.content as string) ? '.md' : '.txt',
                extra: getDisplayTime(note),
                actions: (
                  <FlexAlignCenter>
                    <Button
                      size='sm'
                      isIconOnly
                      variant="light"
                      onClick={() => handleEditNote(note)}
                      aria-label="Edit note">
                      <EditIcon size={14} />
                    </Button>
                    <StatusIconWrapper>
                      <StatusIcon
                        sourceId={note.id}
                        base={base}
                        getProcessingStatus={getProcessingStatus}
                        type="note"
                      />
                    </StatusIconWrapper>
                    <Button
                      size='sm'
                      isIconOnly
                      variant="light"
                      color="danger"
                      onClick={() => removeItem(note)}
                      aria-label="Delete note">
                      <DeleteIcon size={14} className="lucide-custom" />
                    </Button>
                  </FlexAlignCenter>
                )
              }}
            />
          )}
        </DynamicVirtualList>
      </div>
    </ItemContainer>
  )
}



export default KnowledgeNotes
