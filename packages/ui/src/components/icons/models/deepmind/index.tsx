import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DeepmindAvatar } from './avatar'
import { DeepmindLight } from './light'

const Deepmind = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DeepmindLight {...props} className={className} />
  return <DeepmindLight {...props} className={className} />
}

export const DeepmindIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Deepmind, {
  Avatar: DeepmindAvatar,
  colorPrimary: '#4285F4'
})

export default DeepmindIcon
