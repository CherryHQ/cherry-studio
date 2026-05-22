import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GithubAvatar } from './avatar'
import { GithubDark } from './dark'
import { GithubLight } from './light'

const Github = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GithubLight {...props} className={className} />
  if (variant === 'dark') return <GithubDark {...props} className={className} />
  return (
    <>
      <GithubLight className={cn(className, 'dark:hidden')} {...props} />
      <GithubDark className={cn(className, 'hidden dark:block')} {...props} />
    </>
  )
}

export const GithubIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Github, {
  Avatar: GithubAvatar,
  colorPrimary: '#000000'
})

export default GithubIcon
