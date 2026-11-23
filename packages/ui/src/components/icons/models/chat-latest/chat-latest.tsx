import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ChatLatestAvatar } from './avatar'
import { ChatLatestLight } from './light'

const ChatLatest = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ChatLatestLight {...props} className={className} />

  return <ChatLatestLight {...props} className={className} />
}

export const ChatLatestIcon: CompoundIcon = /*#__PURE__*/ Object.assign(ChatLatest, {
  Avatar: ChatLatestAvatar,
  colorPrimary: '#CEDFFE'
})

export default ChatLatestIcon
