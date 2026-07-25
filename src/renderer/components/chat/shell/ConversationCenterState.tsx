import ConversationComposerLoading from '@renderer/components/composer/ConversationComposerLoading'

import { MessageListInitialLoading } from '../messages/layout/MessageListLoading'
import ConversationStageCenter from './ConversationStageCenter'

interface ConversationCenterStateProps {
  state: 'loading' | 'empty'
}

export default function ConversationCenterState({ state }: ConversationCenterStateProps) {
  if (state === 'loading') {
    return (
      <ConversationStageCenter
        placement="docked"
        main={<MessageListInitialLoading />}
        composer={<ConversationComposerLoading />}
      />
    )
  }

  return <div className="h-full min-h-0 flex-1" />
}
