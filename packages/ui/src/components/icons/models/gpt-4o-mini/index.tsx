import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt4oMiniAvatar } from './avatar'
import { Gpt4oMiniLight } from './light'

const Gpt4oMini = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt4oMiniLight {...props} className={className} />
  return <Gpt4oMiniLight {...props} className={className} />
}

export const Gpt4oMiniIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt4oMini, {
  Avatar: Gpt4oMiniAvatar,
  colorPrimary: '#000000'
})

export default Gpt4oMiniIcon
