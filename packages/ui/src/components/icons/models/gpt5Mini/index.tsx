import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt5MiniAvatar } from './avatar'
import { Gpt5MiniLight } from './light'

const Gpt5Mini = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt5MiniLight {...props} className={className} />
  return <Gpt5MiniLight {...props} className={className} />
}

export const Gpt5MiniIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt5Mini, {
  Avatar: Gpt5MiniAvatar,
  colorPrimary: '#000000'
})

export default Gpt5MiniIcon
