import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt41NanoAvatar } from './avatar'
import { Gpt41NanoLight } from './light'

const Gpt41Nano = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt41NanoLight {...props} className={className} />
  return <Gpt41NanoLight {...props} className={className} />
}

export const Gpt41NanoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt41Nano, {
  Avatar: Gpt41NanoAvatar,
  colorPrimary: '#000000'
})

export default Gpt41NanoIcon
