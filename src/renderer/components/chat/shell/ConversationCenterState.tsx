import { LoadingIcon } from '@renderer/components/Icons'

interface ConversationCenterStateProps {
  state: 'loading' | 'empty'
}

export default function ConversationCenterState({ state }: ConversationCenterStateProps) {
  if (state === 'loading') {
    return (
      <div className="flex h-full flex-1 items-center justify-center">
        <LoadingIcon color="var(--color-foreground-secondary)" />
      </div>
    )
  }

  return <div className="h-full min-h-0 flex-1" />
}
