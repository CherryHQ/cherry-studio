import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { YouAvatar } from './avatar'
import { YouDark } from './dark'
import { YouLight } from './light'

const You = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <YouLight className={cn('dark:hidden', className)} {...props} />
    <YouDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const YouIcon: CompoundIcon = /*#__PURE__*/ Object.assign(You, {
  Light: YouLight,
  Dark: YouDark,
  Avatar: YouAvatar,
  colorPrimary: '#000000'
})

export default YouIcon
