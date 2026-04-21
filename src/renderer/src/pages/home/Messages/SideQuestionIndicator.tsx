import { getThreadQuestionCount } from '@renderer/hooks/useSideQuestion'
import { EventEmitter } from '@renderer/services/EventService'
import type { Message } from '@renderer/types/newMessage'
import { MessageSquarePlus } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  message: Message
}

const SideQuestionIndicator: FC<Props> = ({ message }) => {
  const { t } = useTranslation()
  const count = getThreadQuestionCount(message.id)

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    void EventEmitter.emit('open-side-question', message)
  }

  return (
    <IndicatorButton onClick={handleClick} title={t('chat.sideQuestion.title')}>
      <MessageSquarePlus size={13} />
      <CountText>
        {count} {t('chat.sideQuestion.count')}
      </CountText>
    </IndicatorButton>
  )
}

const IndicatorButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  margin-top: 4px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-primary);
  font-size: 12px;
  border-radius: 4px;
  transition: background-color 0.2s;

  &:hover {
    background-color: var(--color-background-soft);
  }
`

const CountText = styled.span`
  font-size: 12px;
`

export default SideQuestionIndicator
