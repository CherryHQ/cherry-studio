import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { TavilyAvatar } from './avatar'
import { TavilyDark } from './dark'
import { TavilyLight } from './light'

const Tavily = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <TavilyLight className={cn('dark:hidden', className)} {...props} />
    <TavilyDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const TavilyIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Tavily, {
  Light: TavilyLight,
  Dark: TavilyDark,
  Avatar: TavilyAvatar,
  colorPrimary: '#8FBCFA'
})

export default TavilyIcon
