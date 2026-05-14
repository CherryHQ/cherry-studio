import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { TavilyAvatar } from './avatar'
import { TavilyDark } from './dark'
import { TavilyLight } from './light'

const Tavily = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <TavilyLight {...props} className={className} />
  if (variant === 'dark') return <TavilyDark {...props} className={className} />
  return (
    <>
      <TavilyLight className={cn('dark:hidden', className)} {...props} />
      <TavilyDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const TavilyIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Tavily, {
  Avatar: TavilyAvatar,
  colorPrimary: '#8FBCFA'
})

export default TavilyIcon
