import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import CustomTag from '@renderer/components/Tags/CustomTag'
import type { Assistant } from '@renderer/types'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

const MentionAssistantInput: FC<{
  assistant: Assistant
  onRemoveAssistant: () => void
}> = ({ assistant, onRemoveAssistant }) => {
  const { t } = useTranslation()

  return (
    <div className="w-full px-[15px] py-[5px]">
      <HorizontalScrollContainer dependencies={[assistant]} expandable>
        <CustomTag
          icon={<span>{assistant.emoji || '🤖'}</span>}
          color="var(--color-primary)"
          closable
          onClose={onRemoveAssistant}>
          {t('chat.input.mention_assistant.tag_prefix')} · {assistant.name}
        </CustomTag>
      </HorizontalScrollContainer>
    </div>
  )
}

export default MentionAssistantInput
