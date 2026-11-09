import type { CompoundIcon, CompoundIconProps } from '../../types'
import { NapkinAvatar } from './avatar'
import { NapkinLight } from './light'

const Napkin = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <NapkinLight {...props} className={className} />
  return <NapkinLight {...props} className={className} />
}

export const NapkinIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Napkin, {
  Avatar: NapkinAvatar,
  colorPrimary: '#000000'
})

export default NapkinIcon
