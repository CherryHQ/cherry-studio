import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AntAfuAvatar } from './avatar'
import { AntAfuLight } from './light'

const AntAfu = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AntAfuLight {...props} className={className} />
  return <AntAfuLight {...props} className={className} />
}

export const AntAfuIcon: CompoundIcon = /*#__PURE__*/ Object.assign(AntAfu, {
  Avatar: AntAfuAvatar,
  colorPrimary: '#000000'
})

export default AntAfuIcon
