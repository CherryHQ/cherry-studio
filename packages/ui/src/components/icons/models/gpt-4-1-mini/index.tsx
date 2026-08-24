import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt41MiniAvatar } from './avatar'
import { Gpt41MiniLight } from './light'

const Gpt41Mini = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt41MiniLight {...props} className={className} />
  return <Gpt41MiniLight {...props} className={className} />
}

export const Gpt41MiniIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt41Mini, {
  Avatar: Gpt41MiniAvatar,
  colorPrimary: '#000000'
})

export default Gpt41MiniIcon
