import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { OcoolaiAvatar } from './avatar'
import { OcoolaiDark } from './dark'
import { OcoolaiLight } from './light'

const Ocoolai = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <OcoolaiLight className={cn('dark:hidden', className)} {...props} />
    <OcoolaiDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const OcoolaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ocoolai, {
  Light: OcoolaiLight,
  Dark: OcoolaiDark,
  Avatar: OcoolaiAvatar,
  colorPrimary: '#000000'
})

export default OcoolaiIcon
