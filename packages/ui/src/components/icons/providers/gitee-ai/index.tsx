import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GiteeAiAvatar } from './avatar'
import { GiteeAiDark } from './dark'
import { GiteeAiLight } from './light'

const GiteeAi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GiteeAiLight {...props} className={className} />
  if (variant === 'dark') return <GiteeAiDark {...props} className={className} />
  return (
    <>
      <GiteeAiLight className={cn('dark:hidden', className)} {...props} />
      <GiteeAiDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const GiteeAiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GiteeAi, {
  Avatar: GiteeAiAvatar,
  colorPrimary: '#000000'
})

export default GiteeAiIcon
