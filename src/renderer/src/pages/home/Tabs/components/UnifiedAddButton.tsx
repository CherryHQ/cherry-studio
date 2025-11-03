import { useDisclosure } from '@heroui/react'
import AddAssistantOrAgentPopup from '@renderer/components/Popups/AddAssistantOrAgentPopup'
import { AgentModal } from '@renderer/components/Popups/agent/AgentModal'
import { useAppDispatch } from '@renderer/store'
import { setActiveTopicOrSessionAction } from '@renderer/store/runtime'
import type { AgentEntity, Assistant, Topic } from '@renderer/types'
import type { FC } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import AddButton from './AddButton'

interface UnifiedAddButtonProps {
  onCreateAssistant: () => void
  setActiveAssistant: (a: Assistant) => void
  setActiveAgentId: (id: string) => void
}

const UnifiedAddButton: FC<UnifiedAddButtonProps> = ({ onCreateAssistant, setActiveAssistant, setActiveAgentId }) => {
  const { t } = useTranslation()
  const { isOpen: isAgentModalOpen, onOpen: onAgentModalOpen, onClose: onAgentModalClose } = useDisclosure()
  const dispatch = useAppDispatch()

  const handleAddButtonClick = () => {
    AddAssistantOrAgentPopup.show({
      onSelect: (type) => {
        if (type === 'assistant') {
          onCreateAssistant()
        } else if (type === 'agent') {
          onAgentModalOpen()
        }
      }
    })
  }

  const afterCreate = useCallback(
    (a: AgentEntity) => {
      // TODO: should allow it to be null
      setActiveAssistant({
        id: 'fake',
        name: '',
        prompt: '',
        topics: [
          {
            id: 'fake',
            assistantId: 'fake',
            name: 'fake',
            createdAt: '',
            updatedAt: '',
            messages: []
          } as unknown as Topic
        ],
        type: 'chat'
      })
      setActiveAgentId(a.id)
      dispatch(setActiveTopicOrSessionAction('session'))
    },
    [dispatch, setActiveAgentId, setActiveAssistant]
  )

  return (
    <div className="mb-1">
      <AddButton onPress={handleAddButtonClick} className="-mt-[1px] mb-[2px]">
        {t('chat.add.assistant.title')}
      </AddButton>
      <AgentModal isOpen={isAgentModalOpen} onClose={onAgentModalClose} afterSubmit={afterCreate} />
    </div>
  )
}

export default UnifiedAddButton
