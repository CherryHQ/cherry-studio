import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MinTop3Avatar } from './avatar'
import { MinTop3Light } from './light'

const MinTop3 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MinTop3Light {...props} className={className} />
  return <MinTop3Light {...props} className={className} />
}

export const MinTop3Icon: CompoundIcon = /*#__PURE__*/ Object.assign(MinTop3, {
  Avatar: MinTop3Avatar,
  colorPrimary: '#FFF0A0'
})

export default MinTop3Icon
