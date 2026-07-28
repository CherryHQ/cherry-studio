import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ZhidaAvatar } from './avatar'
import { ZhidaLight } from './light'

const Zhida = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ZhidaLight {...props} className={className} />
  return <ZhidaLight {...props} className={className} />
}

export const ZhidaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Zhida, {
  Avatar: ZhidaAvatar,
  colorPrimary: '#000000'
})

export default ZhidaIcon
