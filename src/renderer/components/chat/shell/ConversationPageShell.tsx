import { usePreference } from '@data/hooks/usePreference'
import { cn } from '@renderer/utils/style'
import type { ReactNode, Ref } from 'react'

import ConversationShell, { type ConversationShellProps } from './ConversationShell'

export type ConversationCenterSlot = {
  className?: string
  content: ReactNode
  id?: string
  ref?: Ref<HTMLDivElement>
}

export type ConversationPageShellProps = Omit<
  ConversationShellProps,
  'center' | 'centerClassName' | 'centerId' | 'centerRef' | 'className'
> & {
  center: ConversationCenterSlot
  className?: string
}

export default function ConversationPageShell({ center, className, ...props }: ConversationPageShellProps) {
  const [messageStyle] = usePreference('chat.message.style')

  return (
    <ConversationShell
      {...props}
      className={cn(messageStyle, className)}
      center={center.content}
      centerClassName={center.className}
      centerId={center.id}
      centerRef={center.ref}
    />
  )
}
