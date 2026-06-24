import { MessageListInitialLoading } from '../messages/layout/MessageListLoading'

interface ConversationCenterStateProps {
  state: 'loading' | 'empty'
}

export default function ConversationCenterState({ state }: ConversationCenterStateProps) {
  if (state === 'loading') return <MessageListInitialLoading />

  return <div className="h-full min-h-0 flex-1" />
}
