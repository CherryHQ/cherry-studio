import AssistantSettingsPopup from '@renderer/components/AssistantSettings'
import { Assistant } from '@renderer/types'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  assistant: Assistant
}

const Prompt: FC<Props> = ({ assistant }) => {
  const { t } = useTranslation()

  const prompt = assistant.prompt || t('chat.default.description')

  if (!prompt) {
    return null
  }

  return (
    <Container onClick={() => AssistantSettingsPopup.show({ assistant })}>
      <Text>{prompt}</Text>
    </Container>
  )
}

const Container = styled.div`
  padding: 10px 20px;
  background-color: var(--chat-background-assistant);
  margin-bottom: 20px;
  margin: 0 20px 0 20px;
  border-radius: 6px;
  cursor: pointer;
`

const Text = styled.div`
  color: var(--color-text-2);
  font-size: 12px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`

export default Prompt
