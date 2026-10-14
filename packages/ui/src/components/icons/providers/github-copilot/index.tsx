import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GithubCopilotAvatar } from './avatar'
import { GithubCopilotDark } from './dark'
import { GithubCopilotLight } from './light'

const GithubCopilot = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GithubCopilotLight {...props} className={className} />
  if (variant === 'dark') return <GithubCopilotDark {...props} className={className} />
  return (
    <>
      <GithubCopilotLight className={cn('dark:hidden', className)} {...props} />
      <GithubCopilotDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const GithubCopilotIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GithubCopilot, {
  Avatar: GithubCopilotAvatar,
  colorPrimary: '#000000'
})

export default GithubCopilotIcon
