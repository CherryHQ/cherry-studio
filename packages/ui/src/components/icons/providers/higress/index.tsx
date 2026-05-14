import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { HigressAvatar } from './avatar'
import { HigressDark } from './dark'
import { HigressLight } from './light'

const Higress = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <HigressLight className={cn('dark:hidden', className)} {...props} />
    <HigressDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const HigressIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Higress, {
  Light: HigressLight,
  Dark: HigressDark,
  Avatar: HigressAvatar,
  colorPrimary: '#000000'
})

export default HigressIcon
