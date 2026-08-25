import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt35TurboAvatar } from './avatar'
import { Gpt35TurboLight } from './light'

const Gpt35Turbo = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt35TurboLight {...props} className={className} />
  return <Gpt35TurboLight {...props} className={className} />
}

export const Gpt35TurboIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt35Turbo, {
  Avatar: Gpt35TurboAvatar,
  colorPrimary: '#000000'
})

export default Gpt35TurboIcon
