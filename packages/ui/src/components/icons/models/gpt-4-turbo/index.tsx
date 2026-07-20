import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt4TurboAvatar } from './avatar'
import { Gpt4TurboLight } from './light'

const Gpt4Turbo = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt4TurboLight {...props} className={className} />
  return <Gpt4TurboLight {...props} className={className} />
}

export const Gpt4TurboIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt4Turbo, {
  Avatar: Gpt4TurboAvatar,
  colorPrimary: '#000000'
})

export default Gpt4TurboIcon
