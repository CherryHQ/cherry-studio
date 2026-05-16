import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt51CodexMiniAvatar } from './avatar'
import { Gpt51CodexMiniLight } from './light'

const Gpt51CodexMini = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt51CodexMiniLight {...props} className={className} />
  return <Gpt51CodexMiniLight {...props} className={className} />
}

export const Gpt51CodexMiniIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt51CodexMini, {
  Avatar: Gpt51CodexMiniAvatar,
  colorPrimary: '#000000'
})

export default Gpt51CodexMiniIcon
