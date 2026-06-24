import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { FirecrawlAvatar } from './avatar'
import { FirecrawlDark } from './dark'
import { FirecrawlLight } from './light'

const Firecrawl = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <FirecrawlLight {...props} className={className} />
  if (variant === 'dark') return <FirecrawlDark {...props} className={className} />
  return (
    <>
      <FirecrawlLight className={cn('dark:hidden', className)} {...props} />
      <FirecrawlDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const FirecrawlIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Firecrawl, {
  Avatar: FirecrawlAvatar,
  colorPrimary: '#FA5D19'
})

export default FirecrawlIcon
