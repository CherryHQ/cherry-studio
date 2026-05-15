import { Button } from '@cherrystudio/ui'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import EmojiIcon from '@renderer/components/EmojiIcon'
import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import { AssistantSelector, ModelSelector } from '@renderer/components/Selector'
import { fromSharedModel } from '@renderer/config/models/_bridge'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useProviderDisplayName } from '@renderer/hooks/useProviders'
import { useTopicMutations } from '@renderer/hooks/useTopicDataApi'
import { getLeadingEmoji } from '@renderer/utils'
import type { Model as SharedModel } from '@shared/data/types/model'
import { isNonChatModel, isWebSearchModel } from '@shared/utils/model'
import { ChevronDown } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import Tools from '../Tools'

type TopicContentProps = {
  /** `undefined` when the topic has no associated assistant. */
  assistantId: string | undefined
  topicId: string
  onOpenSettings: () => void
}

const modelFilter = (m: SharedModel) => !isNonChatModel(m)

const TopicContent = ({ assistantId, topicId, onOpenSettings }: TopicContentProps) => {
  const { t } = useTranslation()
  const { assistant, model: currentSharedModel, setModel } = useAssistant(assistantId)
  const { updateTopic } = useTopicMutations()
  const assistantName = useMemo(() => assistant?.name || t('chat.default.name'), [assistant?.name, t])
  const currentRendererModel = useMemo(
    () => (currentSharedModel ? fromSharedModel(currentSharedModel) : undefined),
    [currentSharedModel]
  )
  const providerName = useProviderDisplayName(currentSharedModel?.providerId)

  const handleAssistantChange = useCallback(
    async (nextId: string | null) => {
      if (!nextId || nextId === assistantId) return
      await updateTopic(topicId, { assistantId: nextId })
    },
    [assistantId, topicId, updateTopic]
  )

  const handleModelSelect = useCallback(
    (model: SharedModel | undefined) => {
      if (!model || !assistant) return
      const enabledWebSearch = isWebSearchModel(model)
      const next = fromSharedModel(model)
      setModel(next, { enableWebSearch: enabledWebSearch && assistant.settings.enableWebSearch })
    },
    [assistant, setModel]
  )

  return (
    <>
      <HorizontalScrollContainer className="ml-2 flex-initial">
        <div className="flex flex-nowrap items-center gap-2">
          <AssistantSelector
            multi={false}
            value={assistantId ?? null}
            onChange={handleAssistantChange}
            trigger={
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 rounded-full px-2 text-xs">
                <EmojiIcon emoji={assistant?.emoji || getLeadingEmoji(assistantName)} size={20} />
                <span className="max-w-40 truncate">{assistantName}</span>
                <ChevronDown size={14} className="text-muted-foreground" />
              </Button>
            }
          />

          <ModelSelector
            multiple={false}
            value={currentSharedModel}
            onSelect={handleModelSelect}
            filter={modelFilter}
            shortcut="chat.select_model"
            trigger={
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 rounded-full px-2 text-xs">
                <ModelAvatar model={currentRendererModel} size={20} />
                <span className="max-w-60 truncate">
                  {currentRendererModel ? currentRendererModel.name : t('button.select_model')}
                  {providerName ? ` | ${providerName}` : ''}
                </span>
                <ChevronDown size={14} className="text-muted-foreground" />
              </Button>
            }
          />
        </div>
      </HorizontalScrollContainer>
      <Tools onOpenSettings={onOpenSettings} />
    </>
  )
}

export default TopicContent
