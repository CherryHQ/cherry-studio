import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Ai360Avatar } from './avatar'
import { Ai360Light } from './light'

const Ai360 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Ai360Light {...props} className={className} />
  return <Ai360Light {...props} className={className} />
}

export const Ai360Icon: CompoundIcon = /*#__PURE__*/ Object.assign(Ai360, {
  Avatar: Ai360Avatar,
  colorPrimary: '#000000'
})

export default Ai360Icon
