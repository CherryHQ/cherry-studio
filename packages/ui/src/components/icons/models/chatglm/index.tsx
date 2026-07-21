import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ChatglmAvatar } from './avatar'
import { ChatglmLight } from './light'

const Chatglm = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ChatglmLight {...props} className={className} />
  return <ChatglmLight {...props} className={className} />
}

export const ChatglmIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Chatglm, {
  Avatar: ChatglmAvatar,
  colorPrimary: '#000000'
})

export default ChatglmIcon
