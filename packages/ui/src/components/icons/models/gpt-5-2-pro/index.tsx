import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt52ProAvatar } from './avatar'
import { Gpt52ProLight } from './light'

const Gpt52Pro = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt52ProLight {...props} className={className} />

  return <Gpt52ProLight {...props} className={className} />
}

export const Gpt52ProIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt52Pro, {
  Avatar: Gpt52ProAvatar,
  colorPrimary: '#d1e3ff'
})

export default Gpt52ProIcon
