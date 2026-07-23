import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt52CodexAvatar } from './avatar'
import { Gpt52CodexLight } from './light'

const Gpt52Codex = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt52CodexLight {...props} className={className} />
  return <Gpt52CodexLight {...props} className={className} />
}

export const Gpt52CodexIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt52Codex, {
  Avatar: Gpt52CodexAvatar,
  colorPrimary: '#000000'
})

export default Gpt52CodexIcon
