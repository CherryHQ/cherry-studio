import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Ph8Avatar } from './avatar'
import { Ph8Light } from './light'

const Ph8 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Ph8Light {...props} className={className} />
  return <Ph8Light {...props} className={className} />
}

export const Ph8Icon: CompoundIcon = /*#__PURE__*/ Object.assign(Ph8, {
  Avatar: Ph8Avatar,
  colorPrimary: '#00F0FF'
})

export default Ph8Icon
