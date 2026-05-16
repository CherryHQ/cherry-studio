import type { CompoundIcon, CompoundIconProps } from '../../types'
import { LingxiAvatar } from './avatar'
import { LingxiLight } from './light'

const Lingxi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <LingxiLight {...props} className={className} />
  return <LingxiLight {...props} className={className} />
}

export const LingxiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Lingxi, {
  Avatar: LingxiAvatar,
  colorPrimary: '#000000'
})

export default LingxiIcon
