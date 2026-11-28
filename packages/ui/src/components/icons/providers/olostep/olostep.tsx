import type { CompoundIcon, CompoundIconProps } from '../../types'
import { OlostepAvatar } from './avatar'
import { OlostepLight } from './light'

const Olostep = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <OlostepLight {...props} className={className} />
  return <OlostepLight {...props} className={className} />
}

export const OlostepIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Olostep, {
  Avatar: OlostepAvatar,
  colorPrimary: '#635BFF'
})

export default OlostepIcon
