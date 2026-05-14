import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { UpstageAvatar } from './avatar'
import { UpstageDark } from './dark'
import { UpstageLight } from './light'

const Upstage = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <UpstageLight className={cn('dark:hidden', className)} {...props} />
    <UpstageDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const UpstageIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Upstage, {
  Light: UpstageLight,
  Dark: UpstageDark,
  Avatar: UpstageAvatar,
  colorPrimary: '#8867FB'
})

export default UpstageIcon
