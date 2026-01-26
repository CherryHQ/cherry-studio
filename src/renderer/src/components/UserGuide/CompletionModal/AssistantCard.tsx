import type { AssistantPreset } from '@renderer/types'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AssistantCardContainer,
  AssistantDescription,
  AssistantIcon,
  AssistantInfo,
  AssistantName,
  ChatButton
} from './styles'

interface AssistantCardProps {
  assistant: AssistantPreset
  onClick: () => void
}

const AssistantCard: FC<AssistantCardProps> = ({ assistant, onClick }) => {
  const { t } = useTranslation()
  const emoji = assistant.emoji || '🤖'

  return (
    <AssistantCardContainer onClick={onClick}>
      <AssistantIcon>{emoji}</AssistantIcon>
      <AssistantInfo>
        <AssistantName>{assistant.name}</AssistantName>
        <AssistantDescription>{assistant.description || assistant.prompt?.slice(0, 50)}</AssistantDescription>
      </AssistantInfo>
      <ChatButton className="chat-button">{t('userGuide.completionModal.startChat')}</ChatButton>
    </AssistantCardContainer>
  )
}

export default AssistantCard
