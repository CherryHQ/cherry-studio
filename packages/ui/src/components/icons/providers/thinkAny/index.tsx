import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { ThinkAnyAvatar } from './avatar'
import { ThinkAnyDark } from './dark'
import { ThinkAnyLight } from './light'

const ThinkAny = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <ThinkAnyLight className={cn('dark:hidden', className)} {...props} />
    <ThinkAnyDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const ThinkAnyIcon: CompoundIcon = /*#__PURE__*/ Object.assign(ThinkAny, {
  Light: ThinkAnyLight,
  Dark: ThinkAnyDark,
  Avatar: ThinkAnyAvatar,
  colorPrimary: '#000000'
})

export default ThinkAnyIcon
