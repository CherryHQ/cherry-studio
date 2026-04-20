import AddButton from '@renderer/components/AddButton'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface AssistantAddButtonProps {
  onCreateAssistant: () => void
}

const AssistantAddButton: FC<AssistantAddButtonProps> = ({ onCreateAssistant }) => {
  const { t } = useTranslation()

  return (
    <div className="-mt-0.5 mb-1.5">
      <AddButton onClick={onCreateAssistant}>{t('chat.add.assistant.title')}</AddButton>
    </div>
  )
}

export default AssistantAddButton
