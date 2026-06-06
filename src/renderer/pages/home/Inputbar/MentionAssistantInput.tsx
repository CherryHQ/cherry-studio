import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import CustomTag from '@renderer/components/Tags/CustomTag'
import type { Assistant } from '@renderer/types'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const MentionAssistantInput: FC<{
  assistant: Assistant
  onRemoveAssistant: () => void
}> = ({ assistant, onRemoveAssistant }) => {
  const { t } = useTranslation()

  return (
    <Container>
      <HorizontalScrollContainer dependencies={[assistant]} expandable>
        <CustomTag
          icon={<span>{assistant.emoji || '🤖'}</span>}
          color="var(--color-primary)"
          closable
          onClose={onRemoveAssistant}>
          {t('chat.input.mention_assistant.tag_prefix')} · {assistant.name}
        </CustomTag>
      </HorizontalScrollContainer>
    </Container>
  )
}

const Container = styled.div`
  width: 100%;
  padding: 5px 15px 5px 15px;
`

export default MentionAssistantInput
