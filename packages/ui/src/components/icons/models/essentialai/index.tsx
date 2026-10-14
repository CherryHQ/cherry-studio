import type { CompoundIcon, CompoundIconProps } from '../../types'
import { EssentialaiAvatar } from './avatar'
import { EssentialaiLight } from './light'

const Essentialai = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <EssentialaiLight {...props} className={className} />
  return <EssentialaiLight {...props} className={className} />
}

export const EssentialaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Essentialai, {
  Avatar: EssentialaiAvatar,
  colorPrimary: '#000000'
})

export default EssentialaiIcon
