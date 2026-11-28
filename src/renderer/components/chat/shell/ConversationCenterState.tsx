import { useTranslation } from 'react-i18next'

import { EmptyState } from '@cherrystudio/ui'

import { MessageListInitialLoading } from '../messages/layout/MessageListLoading'
import { ConversationCenterScene } from './ConversationCenterScene'
import ConversationStageCenter from './ConversationStageCenter'

interface ConversationCenterStateProps {
  state: 'loading' | 'empty'
  variant?: 'chat' | 'agent'
  /** Offered as the empty state's action when the host can start a conversation. */
  onNewConversation?: () => void
}

const EMPTY_COPY = {
  chat: { title: 'chat.empty_scene.title', description: 'chat.empty_scene.description' },
  agent: { title: 'agent.session.empty_scene.title', description: 'agent.session.empty_scene.description' }
} as const

export default function ConversationCenterState({
  state,
  variant = 'chat',
  onNewConversation
}: ConversationCenterStateProps) {
  const { t } = useTranslation()

  if (state === 'loading') {
    return <ConversationStageCenter placement="docked" main={<MessageListInitialLoading />} composer={null} />
  }

  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center">
      <EmptyState
        scene={<ConversationCenterScene variant={variant} />}
        title={t(EMPTY_COPY[variant].title)}
        description={t(EMPTY_COPY[variant].description)}
        actionLabel={onNewConversation ? t('chat.add.topic.title') : undefined}
        onAction={onNewConversation}
      />
    </div>
  )
}
