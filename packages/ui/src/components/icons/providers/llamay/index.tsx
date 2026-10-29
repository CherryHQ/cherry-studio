import type { CompoundIcon, CompoundIconProps } from '../../types'
import { LlamayAvatar } from './avatar'
import { LlamayLight } from './light'

const Llamay = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <LlamayLight {...props} className={className} />
  return <LlamayLight {...props} className={className} />
}

export const LlamayIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Llamay, {
  Avatar: LlamayAvatar,
  colorPrimary: '#1B1A16'
})

export default LlamayIcon
