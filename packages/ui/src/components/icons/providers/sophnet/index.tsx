import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { SophnetAvatar } from './avatar'
import { SophnetDark } from './dark'
import { SophnetLight } from './light'

const Sophnet = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <SophnetLight className={cn('dark:hidden', className)} {...props} />
    <SophnetDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const SophnetIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Sophnet, {
  Light: SophnetLight,
  Dark: SophnetDark,
  Avatar: SophnetAvatar,
  colorPrimary: '#6200EE'
})

export default SophnetIcon
