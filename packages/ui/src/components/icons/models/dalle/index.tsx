import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DalleAvatar } from './avatar'
import { DalleLight } from './light'

const Dalle = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DalleLight {...props} className={className} />
  return <DalleLight {...props} className={className} />
}

export const DalleIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Dalle, {
  Avatar: DalleAvatar,
  colorPrimary: '#FFFF67'
})

export default DalleIcon
