import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import AddButton from './AddButton'

interface AssistantAddButtonProps {
  onCreateAssistant: () => void
}

const AssistantAddButton: FC<AssistantAddButtonProps> = ({ onCreateAssistant }) => {
  const { t } = useTranslation()

  return (
    <div className="-mt-[2px] mb-[6px]">
      <AddButton onClick={onCreateAssistant}>{t('chat.add.assistant.title')}</AddButton>
    </div>
  )
}

export default AssistantAddButton
