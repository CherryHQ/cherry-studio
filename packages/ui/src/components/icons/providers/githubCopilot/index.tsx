import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GithubCopilotAvatar } from './avatar'
import { GithubCopilotLight } from './light'

const GithubCopilot = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GithubCopilotLight {...props} className={cn('text-foreground', className)} />
  return <GithubCopilotLight {...props} className={cn('text-foreground', className)} />
}

export const GithubCopilotIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GithubCopilot, {
  Avatar: GithubCopilotAvatar,
  colorPrimary: '#000000'
})

export default GithubCopilotIcon
