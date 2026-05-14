import type { CompoundIcon, CompoundIconProps } from '../../types'
import { O3Avatar } from './avatar'
import { O3Light } from './light'

const O3 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <O3Light {...props} className={className} />
  return <O3Light {...props} className={className} />
}

export const O3Icon: CompoundIcon = /*#__PURE__*/ Object.assign(O3, {
  Avatar: O3Avatar,
  colorPrimary: '#F5F6FC'
})

export default O3Icon
