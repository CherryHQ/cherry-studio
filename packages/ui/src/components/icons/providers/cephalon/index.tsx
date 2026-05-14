import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { CephalonAvatar } from './avatar'
import { CephalonDark } from './dark'
import { CephalonLight } from './light'

const Cephalon = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <CephalonLight className={cn('dark:hidden', className)} {...props} />
    <CephalonDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const CephalonIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Cephalon, {
  Light: CephalonLight,
  Dark: CephalonDark,
  Avatar: CephalonAvatar,
  colorPrimary: '#000000'
})

export default CephalonIcon
