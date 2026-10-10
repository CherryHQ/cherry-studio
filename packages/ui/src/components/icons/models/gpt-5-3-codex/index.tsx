import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt53CodexAvatar } from './avatar'
import { Gpt53CodexLight } from './light'

const Gpt53Codex = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt53CodexLight {...props} className={className} />
  return <Gpt53CodexLight {...props} className={className} />
}

export const Gpt53CodexIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt53Codex, {
  Avatar: Gpt53CodexAvatar,
  colorPrimary: '#000000'
})

export default Gpt53CodexIcon
