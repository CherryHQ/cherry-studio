import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DolaAvatar } from './avatar'
import { DolaLight } from './light'

const Dola = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DolaLight {...props} className={className} />
  return <DolaLight {...props} className={className} />
}

export const DolaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Dola, {
  Avatar: DolaAvatar,
  colorPrimary: '#000000'
})

export default DolaIcon
