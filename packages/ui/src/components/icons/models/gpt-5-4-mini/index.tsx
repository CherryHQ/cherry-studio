import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt54MiniAvatar } from './avatar'
import { Gpt54MiniLight } from './light'

const Gpt54Mini = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt54MiniLight {...props} className={className} />
  return <Gpt54MiniLight {...props} className={className} />
}

export const Gpt54MiniIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt54Mini, {
  Avatar: Gpt54MiniAvatar,
  colorPrimary: '#c0d1ff'
})

export default Gpt54MiniIcon
