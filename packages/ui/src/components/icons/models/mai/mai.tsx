import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MaiAvatar } from './avatar'
import { MaiLight } from './light'

const Mai = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MaiLight {...props} className={className} />
  return <MaiLight {...props} className={className} />
}

export const MaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mai, {
  Avatar: MaiAvatar,
  colorPrimary: '#5F4E41'
})

export default MaiIcon
