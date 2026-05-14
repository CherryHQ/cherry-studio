import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { SearxngAvatar } from './avatar'
import { SearxngDark } from './dark'
import { SearxngLight } from './light'

const Searxng = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <SearxngLight className={cn('dark:hidden', className)} {...props} />
    <SearxngDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const SearxngIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Searxng, {
  Light: SearxngLight,
  Dark: SearxngDark,
  Avatar: SearxngAvatar,
  colorPrimary: '#3050FF'
})

export default SearxngIcon
