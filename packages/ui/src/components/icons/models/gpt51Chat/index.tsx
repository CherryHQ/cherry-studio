import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt51ChatAvatar } from './avatar'
import { Gpt51ChatLight } from './light'

const Gpt51Chat = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt51ChatLight {...props} className={className} />
  return <Gpt51ChatLight {...props} className={className} />
}

export const Gpt51ChatIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt51Chat, {
  Avatar: Gpt51ChatAvatar,
  colorPrimary: '#000000'
})

export default Gpt51ChatIcon
