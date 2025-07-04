import { DeleteOutlined, EditOutlined } from '@ant-design/icons'
import TextEditPopup from '@renderer/components/Popups/TextEditPopup'
import Scrollbar from '@renderer/components/Scrollbar'
import { useKnowledge } from '@renderer/hooks/useKnowledge'
import FileItem from '@renderer/pages/files/FileItem'
import { getProviderName } from '@renderer/services/ProviderService'
import { KnowledgeBase, KnowledgeItem } from '@renderer/types'
import { Button } from 'antd'
import dayjs from 'dayjs'
import { Plus } from 'lucide-react'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import StatusIcon from '../components/StatusIcon'
import { FlexAlignCenter, ItemContainer, ItemHeader, KnowledgeEmptyView, StatusIconWrapper } from '../KnowledgeContent'

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

  const providerName = getProviderName(base?.model.provider || '')
  const disabled = !base?.version || !providerName

  if (!base) {
    return null
  }

  const handleAddNote = async () => {
    if (disabled) {
      return
    }

    const note = await TextEditPopup.show({ text: '', textareaProps: { rows: 20 } })
    note && addNote(note)
  }

  const handleEditNote = async (note: any) => {
    if (disabled) {
      return
    }

    const editedText = await TextEditPopup.show({ text: note.content as string, textareaProps: { rows: 20 } })
    editedText && updateNoteContent(note.id, editedText)
  }

  return (
    <ItemContainer>
      <ItemHeader>
        <Button
          type="primary"
          icon={<Plus size={16} />}
          onClick={(e) => {
            e.stopPropagation()
            handleAddNote()
          }}
          disabled={disabled}>
          {t('knowledge.add_note')}
        </Button>
      </ItemHeader>
      <ItemFlexColumn>
        {noteItems.length === 0 && <KnowledgeEmptyView />}
        {noteItems.reverse().map((note) => (
          <FileItem
            key={note.id}
            fileInfo={{
              name: <span onClick={() => handleEditNote(note)}>{(note.content as string).slice(0, 50)}...</span>,
              ext: '.txt',
              extra: getDisplayTime(note),
              actions: (
                <FlexAlignCenter>
                  <Button type="text" onClick={() => handleEditNote(note)} icon={<EditOutlined />} />
                  <StatusIconWrapper>
                    <StatusIcon sourceId={note.id} base={base} getProcessingStatus={getProcessingStatus} type="note" />
                  </StatusIconWrapper>
                  <Button type="text" danger onClick={() => removeItem(note)} icon={<DeleteOutlined />} />
                </FlexAlignCenter>
              )
            }}
          />
        ))}
      </ItemFlexColumn>
    </ItemContainer>
  )
}

const ItemFlexColumn = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 20px 16px;
  height: calc(100vh - 135px);
`

export default KnowledgeNotes
