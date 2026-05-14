import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { IntelAvatar } from './avatar'
import { IntelDark } from './dark'
import { IntelLight } from './light'

const Intel = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <IntelLight className={cn('dark:hidden', className)} {...props} />
    <IntelDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const IntelIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Intel, {
  Light: IntelLight,
  Dark: IntelDark,
  Avatar: IntelAvatar,
  colorPrimary: '#0071C5'
})

export default IntelIcon
