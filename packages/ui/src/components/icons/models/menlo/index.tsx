import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MenloAvatar } from './avatar'
import { MenloLight } from './light'

const Menlo = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MenloLight {...props} className={className} />
  return <MenloLight {...props} className={className} />
}

export const MenloIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Menlo, {
  Avatar: MenloAvatar,
  colorPrimary: '#FF5C00'
})

export default MenloIcon
