import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { SearxngAvatar } from './avatar'
import { SearxngDark } from './dark'
import { SearxngLight } from './light'

const Searxng = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <SearxngLight {...props} className={className} />
  if (variant === 'dark') return <SearxngDark {...props} className={className} />
  return (
    <>
      <SearxngLight className={cn('dark:hidden', className)} {...props} />
      <SearxngDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const SearxngIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Searxng, {
  Avatar: SearxngAvatar,
  colorPrimary: '#3050FF'
})

export default SearxngIcon
