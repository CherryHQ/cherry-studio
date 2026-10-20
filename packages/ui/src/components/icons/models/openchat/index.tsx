import type { CompoundIcon, CompoundIconProps } from '../../types'
import { OpenchatAvatar } from './avatar'
import { OpenchatLight } from './light'

const Openchat = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <OpenchatLight {...props} className={className} />
  return <OpenchatLight {...props} className={className} />
}

export const OpenchatIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Openchat, {
  Avatar: OpenchatAvatar,
  colorPrimary: '#000000'
})

export default OpenchatIcon
