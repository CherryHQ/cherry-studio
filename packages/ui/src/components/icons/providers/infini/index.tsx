import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { InfiniAvatar } from './avatar'
import { InfiniDark } from './dark'
import { InfiniLight } from './light'

const Infini = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <InfiniLight className={cn('dark:hidden', className)} {...props} />
    <InfiniDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const InfiniIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Infini, {
  Light: InfiniLight,
  Dark: InfiniDark,
  Avatar: InfiniAvatar,
  colorPrimary: '#6A3CFD'
})

export default InfiniIcon
