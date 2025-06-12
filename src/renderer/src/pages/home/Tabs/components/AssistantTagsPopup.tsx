import { Box } from '@renderer/components/Layout'
import { TopView } from '@renderer/components/TopView'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useTags } from '@renderer/hooks/useTags'
import { Button, Empty, Modal } from 'antd'
import { isEmpty } from 'lodash'
import { Trash } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ShowParams {
  title: string
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ title, resolve }) => {
  const [open, setOpen] = useState(true)
  const { allTags, getAssistantsByTag } = useTags()
  const { assistants, updateAssistants } = useAssistants()
  const { t } = useTranslation()

  const onOk = () => {
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  const onDelete = (removedTag: string) => {
    window.modal.confirm({
      title: t('assistants.tags.deleteConfirm'),
      centered: true,
      onOk: () => {
        const relatedAssistants = getAssistantsByTag(removedTag)
        if (!isEmpty(relatedAssistants)) {
          updateAssistants(
            assistants.map((assistant) => {
              const findedAssitant = relatedAssistants.find((_assistant) => _assistant.id === assistant.id)
              return findedAssitant ? { ...findedAssitant, tags: [] } : assistant
            })
          )
        }
      }
    })
  }

  AssistantTagsPopup.hide = onCancel

  return (
    <Modal
      title={title}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      footer={null}
      transitionName="animation-move-down"
      centered>
      <Container>
        {allTags.map((tag) => (
          <TagItem key={tag}>
            <Box mr={8}>{tag}</Box>
            <Button type="text" icon={<Trash size={16} />} danger onClick={() => onDelete(tag)} />
          </TagItem>
        ))}
        {allTags.length === 0 && <Empty description="" />}
      </Container>
    </Modal>
  )
}

const Container = styled.div`
  padding: 12px 0;
  height: 50vh;
  overflow-y: auto;
  &::-webkit-scrollbar {
    display: none;
  }
`

const TagItem = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 8px;
  border-radius: 8px;
  user-select: none;
  background-color: var(--color-background-soft);
  margin-bottom: 8px;
`

const TopViewKey = 'AssistantTagsPopup'

export default class AssistantTagsPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
