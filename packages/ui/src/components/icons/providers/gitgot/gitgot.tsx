import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GitGotAvatar } from './avatar'
import { GitGotLight } from './light'

const GitGot = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GitGotLight {...props} className={className} />
  return <GitGotLight {...props} className={className} />
}

export const GitGotIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GitGot, {
  Avatar: GitGotAvatar,
  colorPrimary: '#2e6f40'
})

export default GitGotIcon
