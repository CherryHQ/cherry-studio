import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ChatgptImageLatestAvatar } from './avatar'
import { ChatgptImageLatestLight } from './light'

const ChatgptImageLatest = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ChatgptImageLatestLight {...props} className={className} />

  return <ChatgptImageLatestLight {...props} className={className} />
}

export const ChatgptImageLatestIcon: CompoundIcon = /*#__PURE__*/ Object.assign(ChatgptImageLatest, {
  Avatar: ChatgptImageLatestAvatar,
  colorPrimary: '#AC98E2'
})

export default ChatgptImageLatestIcon
