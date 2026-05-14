import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DoubaoAvatar } from './avatar'
import { DoubaoLight } from './light'

const Doubao = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DoubaoLight {...props} className={className} />
  return <DoubaoLight {...props} className={className} />
}

export const DoubaoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Doubao, {
  Avatar: DoubaoAvatar,
  colorPrimary: '#1E37FC'
})

export default DoubaoIcon
