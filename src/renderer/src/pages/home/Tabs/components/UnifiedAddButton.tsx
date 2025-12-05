import AddAssistantOrAgentPopup from '@renderer/components/Popups/AddAssistantOrAgentPopup'
import AgentModalPopup from '@renderer/components/Popups/agent/AgentModal'
import { useApiServer } from '@renderer/hooks/useApiServer'
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
  const dispatch = useAppDispatch()
  const { apiServerRunning, startApiServer } = useApiServer()

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

  const handleAddButtonClick = async () => {
    AddAssistantOrAgentPopup.show({
      onSelect: (type) => {
        if (type === 'assistant') {
          onCreateAssistant()
        }

        if (type === 'agent') {
          !apiServerRunning && startApiServer()
          AgentModalPopup.show({ afterSubmit: afterCreate })
        }
      }
    })
  }

  return (
    <div className="-mt-[4px] mb-[6px]">
      <AddButton onClick={handleAddButtonClick} className="">
        {t('chat.add.assistant.title')}
      </AddButton>
    </div>
  )
}

export default UnifiedAddButton
