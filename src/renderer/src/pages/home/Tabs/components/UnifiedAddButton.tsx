import AddAssistantPopup from '@renderer/components/Popups/AddAssistantPopup'
import { useAppDispatch } from '@renderer/store'
import { setActiveTopicOrSessionAction } from '@renderer/store/runtime'
import type { Assistant, Topic } from '@renderer/types'
import type { FC } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import AddButton from './AddButton'

interface UnifiedAddButtonProps {
  onCreateAssistant: () => void
  setActiveAssistant: (a: Assistant) => void
  setActiveAgentId: (id: string) => void
}

const UnifiedAddButton: FC<UnifiedAddButtonProps> = ({ setActiveAssistant, setActiveAgentId }) => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const handleAddButtonClick = useCallback(async () => {
    const result = await AddAssistantPopup.show({ showModeSwitch: true })

    if (!result) return

    if (result.type === 'assistant' && result.assistant) {
      setActiveAssistant(result.assistant)
      setActiveAgentId('')
      dispatch(setActiveTopicOrSessionAction('topic'))
    }

    if (result.type === 'agent' && result.agent) {
      // Set a fake assistant to allow agent mode
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
      setActiveAgentId(result.agent.id)
      dispatch(setActiveTopicOrSessionAction('session'))
    }
  }, [dispatch, setActiveAgentId, setActiveAssistant])

  return (
    <div className="-mt-[2px] mb-[6px]">
      <AddButton onClick={handleAddButtonClick}>{t('chat.add.assistant.title')}</AddButton>
    </div>
  )
}

export default UnifiedAddButton
