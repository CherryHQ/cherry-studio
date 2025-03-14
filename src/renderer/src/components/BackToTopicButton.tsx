import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface BackToTopicButtonProps {
  previousTopicId: string
  previousTopicName: string
}

interface BackButtonData {
  previousTopicId: string
  previousTopicName: string
}

const BackToTopicButton: FC<BackToTopicButtonProps> = () => {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  const [data, setData] = useState<BackButtonData | null>(null)

  useEffect(() => {
    const handleShowBackButton = (data: BackButtonData) => {
      setData(data)
      setVisible(true)
    }

    const handleHideBackButton = () => {
      setVisible(false)
    }

    const handleTopicSelected = () => {
      if (visible) {
        setVisible(false)
      }
    }

    EventEmitter.on(EVENT_NAMES.SHOW_BACK_BUTTON, handleShowBackButton)
    EventEmitter.on(EVENT_NAMES.HIDE_BACK_BUTTON, handleHideBackButton)
    EventEmitter.on(EVENT_NAMES.TOPIC_JUST_SELECTED, handleTopicSelected)

    return () => {
      EventEmitter.off(EVENT_NAMES.SHOW_BACK_BUTTON, handleShowBackButton)
      EventEmitter.off(EVENT_NAMES.HIDE_BACK_BUTTON, handleHideBackButton)
      EventEmitter.off(EVENT_NAMES.TOPIC_JUST_SELECTED, handleTopicSelected)
    }
  }, [visible, data])

  const handleBack = () => {
    if (data) {
      EventEmitter.emit(EVENT_NAMES.NAVIGATE_TO_TOPIC, data.previousTopicId)
      setVisible(false)
    }
  }

  if (!visible || !data) return null

  return (
    <BackButtonContainer>
      <BackButton onClick={handleBack}>
        <BackIcon>←</BackIcon>
        <BackText>
          {t('chat.topics.back_to_topic')} &quot;{data.previousTopicName}&quot;
        </BackText>
      </BackButton>
    </BackButtonContainer>
  )
}

const BackButtonContainer = styled.div`
  position: fixed;
  top: 48px;
  right: 5px;
  z-index: 1000;
`

const BackButton = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  background-color: var(--color-primary);
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);

  &:hover {
    background-color: var(--color-primary);
  }
`

const BackIcon = styled.span`
  font-size: 16px;
`

const BackText = styled.span`
  white-space: nowrap;
`

export default BackToTopicButton
