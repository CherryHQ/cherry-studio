import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Ai2Avatar } from './avatar'
import { Ai2Light } from './light'

const Ai2 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Ai2Light {...props} className={className} />
  return <Ai2Light {...props} className={className} />
}

export const Ai2Icon: CompoundIcon = /*#__PURE__*/ Object.assign(Ai2, {
  Avatar: Ai2Avatar,
  colorPrimary: '#F0529C'
})

export default Ai2Icon
