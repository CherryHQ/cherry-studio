import { Button, Popover, PopoverContent, PopoverTrigger } from '@heroui/react'
import { AgentModal } from '@renderer/components/Popups/agent/AgentModal'
import { Bot, MessageSquare, Plus } from 'lucide-react'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface UnifiedAddButtonProps {
  onCreateAssistant: () => void
}

const UnifiedAddButton: FC<UnifiedAddButtonProps> = ({ onCreateAssistant }) => {
  const { t } = useTranslation()
  const [isPopoverOpen, setIsPopoverOpen] = useState(false)
  const [isAgentModalOpen, setIsAgentModalOpen] = useState(false)

  const handleAddAssistant = () => {
    setIsPopoverOpen(false)
    onCreateAssistant()
  }

  const handleAddAgent = () => {
    setIsPopoverOpen(false)
    setIsAgentModalOpen(true)
  }

  return (
    <div className="mb-2">
      <Popover
        isOpen={isPopoverOpen}
        onOpenChange={setIsPopoverOpen}
        placement="bottom"
        classNames={{
          content: 'p-0 min-w-[200px]'
        }}>
        <PopoverTrigger>
          <Button
            className="w-full justify-start bg-transparent text-foreground-500 hover:bg-[var(--color-list-item)]"
            startContent={<Plus size={16} className="shrink-0" />}>
            {t('common.add')}
          </Button>
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

      <AgentModal isOpen={isAgentModalOpen} onClose={() => setIsAgentModalOpen(false)} />
    </div>
  )
}

export default UnifiedAddButton
