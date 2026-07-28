import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DangbeiAvatar } from './avatar'
import { DangbeiLight } from './light'

const Dangbei = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DangbeiLight {...props} className={className} />
  return <DangbeiLight {...props} className={className} />
}

export const DangbeiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Dangbei, {
  Avatar: DangbeiAvatar,
  colorPrimary: '#000000'
})

export default DangbeiIcon
