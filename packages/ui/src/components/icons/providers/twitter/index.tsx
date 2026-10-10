import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { TwitterAvatar } from './avatar'
import { TwitterDark } from './dark'
import { TwitterLight } from './light'

const Twitter = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <TwitterLight {...props} className={className} />
  if (variant === 'dark') return <TwitterDark {...props} className={className} />
  return (
    <>
      <TwitterLight className={cn('dark:hidden', className)} {...props} />
      <TwitterDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const TwitterIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Twitter, {
  Avatar: TwitterAvatar,
  colorPrimary: '#000000'
})

export default TwitterIcon
