import { AvatarIcon } from '@renderer/components/AvatarIcon'
import { useChatBottomOverlayInset } from '@renderer/components/chat/layout/ChatViewportInsetContext'
import type { AvatarValue } from '@shared/data/types/avatar'

export interface ConversationGreetingProps {
  avatar?: AvatarValue
  title: string
}

/**
 * Welcome state for an empty conversation (chat or agent session).
 *
 * Deliberately distinct from `EmptyState` (no-data): this is an invitation to
 * begin, so it leads with the assistant's own avatar and a warm greeting rather
 * than a muted "no results" glyph. Centered within the space above the docked
 * composer via the bottom-overlay inset, so it reads as connected to the input.
 */
export function ConversationGreeting({ avatar, title }: ConversationGreetingProps) {
  const inset = useChatBottomOverlayInset()

  return (
    <div
      data-testid="conversation-greeting"
      className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center"
      style={{ paddingBottom: inset?.contentBottomPadding ?? 0 }}>
      {avatar && <AvatarIcon avatar={avatar} className="mr-0" size={48} fontSize={28} />}
      <h2 className="m-0 font-medium text-foreground text-lg">{title}</h2>
    </div>
  )
}

export default ConversationGreeting
