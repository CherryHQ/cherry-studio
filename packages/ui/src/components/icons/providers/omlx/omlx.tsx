import type { CompoundIcon, CompoundIconProps } from '../../types'
import { OmlxAvatar } from './avatar'
import { OmlxLight } from './light'

const Omlx = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <OmlxLight {...props} className={className} />
  return <OmlxLight {...props} className={className} />
}

export const OmlxIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Omlx, {
  Avatar: OmlxAvatar,
  colorPrimary: '#000000'
})

export default OmlxIcon
