import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ClaudeCodeAvatar } from './avatar'
import { ClaudeCodeLight } from './light'

const ClaudeCode = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ClaudeCodeLight {...props} className={className} />
  return <ClaudeCodeLight {...props} className={className} />
}

export const ClaudeCodeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(ClaudeCode, {
  Avatar: ClaudeCodeAvatar,
  colorPrimary: '#D97757'
})

export default ClaudeCodeIcon
