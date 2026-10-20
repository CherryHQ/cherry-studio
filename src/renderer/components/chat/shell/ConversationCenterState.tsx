import { MessageListInitialLoading } from '../messages/layout/MessageListLoading'
import ConversationStageCenter from './ConversationStageCenter'

interface ConversationCenterStateProps {
  state: 'loading' | 'empty'
}

export default function ConversationCenterState({ state }: ConversationCenterStateProps) {
  if (state === 'loading') {
    return <ConversationStageCenter placement="docked" main={<MessageListInitialLoading />} composer={null} />
  }

  return <div className="h-full min-h-0 flex-1" />
}
