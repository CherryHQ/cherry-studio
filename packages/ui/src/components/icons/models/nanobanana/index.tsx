import type { CompoundIcon, CompoundIconProps } from '../../types'
import { NanobananaAvatar } from './avatar'
import { NanobananaLight } from './light'

const Nanobanana = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <NanobananaLight {...props} className={className} />
  return <NanobananaLight {...props} className={className} />
}

export const NanobananaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Nanobanana, {
  Avatar: NanobananaAvatar,
  colorPrimary: '#F9C23C'
})

export default NanobananaIcon
