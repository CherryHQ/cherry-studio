import type { CompoundIcon, CompoundIconProps } from '../../types'
import { EzkielynaAvatar } from './avatar'
import { EzkielynaLight } from './light'

const Ezkielyna = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <EzkielynaLight {...props} className={className} />
  return <EzkielynaLight {...props} className={className} />
}

export const EzkielynaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ezkielyna, {
  Avatar: EzkielynaAvatar,
  colorPrimary: '#C2603F'
})

export default EzkielynaIcon
