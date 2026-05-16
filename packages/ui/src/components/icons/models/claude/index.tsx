import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ClaudeAvatar } from './avatar'
import { ClaudeLight } from './light'

const Claude = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ClaudeLight {...props} className={className} />
  return <ClaudeLight {...props} className={className} />
}

export const ClaudeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Claude, {
  Avatar: ClaudeAvatar,
  colorPrimary: '#d97757'
})

export default ClaudeIcon
