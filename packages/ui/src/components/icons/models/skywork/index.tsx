import type { CompoundIcon, CompoundIconProps } from '../../types'
import { SkyworkAvatar } from './avatar'
import { SkyworkLight } from './light'

const Skywork = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <SkyworkLight {...props} className={className} />
  return <SkyworkLight {...props} className={className} />
}

export const SkyworkIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Skywork, {
  Avatar: SkyworkAvatar,
  colorPrimary: '#4D5EFF'
})

export default SkyworkIcon
