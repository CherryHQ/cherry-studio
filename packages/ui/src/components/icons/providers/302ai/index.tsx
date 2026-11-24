import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Ai302Avatar } from './avatar'
import { Ai302Light } from './light'

const Ai302 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Ai302Light {...props} className={className} />
  return <Ai302Light {...props} className={className} />
}

export const Ai302Icon: CompoundIcon = /*#__PURE__*/ Object.assign(Ai302, {
  Avatar: Ai302Avatar,
  colorPrimary: '#eeeef7'
})

export default Ai302Icon
