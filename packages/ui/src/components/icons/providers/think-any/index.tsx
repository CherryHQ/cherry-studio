import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ThinkAnyAvatar } from './avatar'
import { ThinkAnyDark } from './dark'
import { ThinkAnyLight } from './light'

const ThinkAny = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ThinkAnyLight {...props} className={className} />
  if (variant === 'dark') return <ThinkAnyDark {...props} className={className} />
  return (
    <>
      <ThinkAnyLight className={cn('dark:hidden', className)} {...props} />
      <ThinkAnyDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const ThinkAnyIcon: CompoundIcon = /*#__PURE__*/ Object.assign(ThinkAny, {
  Avatar: ThinkAnyAvatar,
  colorPrimary: '#000000'
})

export default ThinkAnyIcon
