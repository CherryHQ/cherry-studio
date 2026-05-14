import type { CompoundIcon, CompoundIconProps } from '../../types'
import { CherryinAvatar } from './avatar'
import { CherryinLight } from './light'

const Cherryin = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <CherryinLight {...props} className={className} />
  return <CherryinLight {...props} className={className} />
}

export const CherryinIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Cherryin, {
  Avatar: CherryinAvatar,
  colorPrimary: '#FF5F5F'
})

export default CherryinIcon
