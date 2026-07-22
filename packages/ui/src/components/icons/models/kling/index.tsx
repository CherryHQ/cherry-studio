import type { CompoundIcon, CompoundIconProps } from '../../types'
import { KlingAvatar } from './avatar'
import { KlingLight } from './light'

const Kling = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <KlingLight {...props} className={className} />
  return <KlingLight {...props} className={className} />
}

export const KlingIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Kling, {
  Avatar: KlingAvatar,
  colorPrimary: '#000000'
})

export default KlingIcon
