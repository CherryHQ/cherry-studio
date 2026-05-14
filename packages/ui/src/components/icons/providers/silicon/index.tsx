import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { SiliconAvatar } from './avatar'
import { SiliconDark } from './dark'
import { SiliconLight } from './light'

const Silicon = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <SiliconLight className={cn('dark:hidden', className)} {...props} />
    <SiliconDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const SiliconIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Silicon, {
  Light: SiliconLight,
  Dark: SiliconDark,
  Avatar: SiliconAvatar,
  colorPrimary: '#6E29F6'
})

export default SiliconIcon
