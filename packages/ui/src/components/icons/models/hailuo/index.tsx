import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { HailuoAvatar } from './avatar'
import { HailuoDark } from './dark'
import { HailuoLight } from './light'

const Hailuo = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <HailuoLight className={cn('dark:hidden', className)} {...props} />
    <HailuoDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const HailuoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Hailuo, {
  Light: HailuoLight,
  Dark: HailuoDark,
  Avatar: HailuoAvatar,
  colorPrimary: '#000000'
})

export default HailuoIcon
