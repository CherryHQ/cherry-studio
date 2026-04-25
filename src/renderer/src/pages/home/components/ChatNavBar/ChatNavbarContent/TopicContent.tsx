import EmojiIcon from '@renderer/components/EmojiIcon'
import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import { useAssistant } from '@renderer/hooks/useAssistant'
import AssistantSettingsPopup from '@renderer/pages/settings/AssistantSettings'
import { getLeadingEmoji } from '@renderer/utils'
import { ChevronRight } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import SelectModelButton from '../../SelectModelButton'
import Tools from '../Tools'

type TopicContentProps = {
  assistantId: string
}

const TopicContent = ({ assistantId }: TopicContentProps) => {
  const { t } = useTranslation()
  const { assistant } = useAssistant(assistantId)
  const assistantName = useMemo(() => assistant?.name || t('chat.default.name'), [assistant?.name, t])

  return (
    <>
      <HorizontalScrollContainer className="ml-2 flex-initial">
        <div className="flex flex-nowrap items-center gap-2">
          {/* Assistant Label */}
          <div
            className="flex h-full cursor-pointer items-center gap-1.5"
            onClick={() => assistant && AssistantSettingsPopup.show({ assistant })}>
            <EmojiIcon emoji={assistant?.emoji || getLeadingEmoji(assistantName)} size={24} />
            <span className="max-w-40 truncate text-xs">{assistantName}</span>
          </div>

          {/* Separator */}
          <ChevronRight className="h-4 w-4 text-gray-400" />

          {/* Model Button */}
          {assistant && <SelectModelButton assistant={assistant} />}
        </div>
      </HorizontalScrollContainer>
      <Tools assistantId={assistantId} />
    </>
  )
}

export default TopicContent
