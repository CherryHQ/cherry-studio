import type { CompoundIcon, CompoundIconProps } from '../../types'
import { JimengAvatar } from './avatar'
import { JimengLight } from './light'

const Jimeng = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <JimengLight {...props} className={className} />
  return <JimengLight {...props} className={className} />
}

export const JimengIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Jimeng, {
  Avatar: JimengAvatar,
  colorPrimary: '#000000'
})

export default JimengIcon
