import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ImaAvatar } from './avatar'
import { ImaLight } from './light'

const Ima = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ImaLight {...props} className={className} />
  return <ImaLight {...props} className={className} />
}

export const ImaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ima, {
  Avatar: ImaAvatar,
  colorPrimary: '#000000'
})

export default ImaIcon
