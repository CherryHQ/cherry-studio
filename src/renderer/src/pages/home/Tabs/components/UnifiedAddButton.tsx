import { Button, Popover, PopoverContent, PopoverTrigger, useDisclosure } from '@heroui/react'
import { AgentModal } from '@renderer/components/Popups/agent/AgentModal'
import { useAppDispatch } from '@renderer/store'
import { setActiveTopicOrSessionAction } from '@renderer/store/runtime'
import { AgentEntity, Assistant, Topic } from '@renderer/types'
import { Bot, MessageSquare } from 'lucide-react'
import { FC, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AddButton from './AddButton'

interface UnifiedAddButtonProps {
  onCreateAssistant: () => void
  setActiveAssistant: (a: Assistant) => void
  setActiveAgentId: (id: string) => void
}

const UnifiedAddButton: FC<UnifiedAddButtonProps> = ({ onCreateAssistant, setActiveAssistant, setActiveAgentId }) => {
  const { t } = useTranslation()
  const [isPopoverOpen, setIsPopoverOpen] = useState(false)
  const { isOpen: isAgentModalOpen, onOpen: onAgentModalOpen, onClose: onAgentModalClose } = useDisclosure()
  const dispatch = useAppDispatch()

  const handleAddAssistant = () => {
    setIsPopoverOpen(false)
    onCreateAssistant()
  }

  const handleAddAgent = () => {
    setIsPopoverOpen(false)
    onAgentModalOpen()
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
      <Popover
        isOpen={isPopoverOpen}
        onOpenChange={setIsPopoverOpen}
        placement="bottom"
        classNames={{ content: 'p-0 min-w-[200px]' }}>
        <PopoverTrigger>
          <AddButton>{t('chat.add.assistant.title')}</AddButton>
        </PopoverTrigger>
        <PopoverContent>
          <div className="flex w-full flex-col gap-1 p-1">
            <Button
              onPress={handleAddAssistant}
              className="w-full justify-start bg-transparent hover:bg-[var(--color-list-item)]"
              startContent={<MessageSquare size={16} className="shrink-0" />}>
              {t('chat.add.assistant.title')}
            </Button>
            <Button
              onPress={handleAddAgent}
              className="w-full justify-start bg-transparent hover:bg-[var(--color-list-item)]"
              startContent={<Bot size={16} className="shrink-0" />}>
              {t('agent.add.title')}
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <AgentModal isOpen={isAgentModalOpen} onClose={onAgentModalClose} afterSubmit={afterCreate} />
    </div>
  )
}

export default UnifiedAddButton
