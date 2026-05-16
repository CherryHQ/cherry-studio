import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DuckAvatar } from './avatar'
import { DuckLight } from './light'

const Duck = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DuckLight {...props} className={className} />
  return <DuckLight {...props} className={className} />
}

export const DuckIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Duck, {
  Avatar: DuckAvatar,
  colorPrimary: '#14307E'
})

export default DuckIcon
