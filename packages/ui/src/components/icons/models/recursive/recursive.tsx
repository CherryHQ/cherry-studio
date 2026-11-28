import type { CompoundIcon, CompoundIconProps } from '../../types'
import { RecursiveAvatar } from './avatar'
import { RecursiveLight } from './light'

const Recursive = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <RecursiveLight {...props} className={className} />
  return <RecursiveLight {...props} className={className} />
}

export const RecursiveIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Recursive, {
  Avatar: RecursiveAvatar,
  colorPrimary: '#000000'
})

export default RecursiveIcon
