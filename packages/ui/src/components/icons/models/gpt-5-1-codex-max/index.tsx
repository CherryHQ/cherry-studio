import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt51CodexMaxAvatar } from './avatar'
import { Gpt51CodexMaxLight } from './light'

const Gpt51CodexMax = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt51CodexMaxLight {...props} className={className} />
  return <Gpt51CodexMaxLight {...props} className={className} />
}

export const Gpt51CodexMaxIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt51CodexMax, {
  Avatar: Gpt51CodexMaxAvatar,
  colorPrimary: '#000000'
})

export default Gpt51CodexMaxIcon
