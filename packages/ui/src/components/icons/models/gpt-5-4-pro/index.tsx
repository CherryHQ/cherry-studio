import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt54ProAvatar } from './avatar'
import { Gpt54ProLight } from './light'

const Gpt54Pro = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt54ProLight {...props} className={className} />
  return <Gpt54ProLight {...props} className={className} />
}

export const Gpt54ProIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt54Pro, {
  Avatar: Gpt54ProAvatar,
  colorPrimary: '#b9c6ff'
})

export default Gpt54ProIcon
