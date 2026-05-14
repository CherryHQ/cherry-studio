import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { MimoAvatar } from './avatar'
import { MimoDark } from './dark'
import { MimoLight } from './light'

const Mimo = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <MimoLight className={cn('dark:hidden', className)} {...props} />
    <MimoDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const MimoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mimo, {
  Light: MimoLight,
  Dark: MimoDark,
  Avatar: MimoAvatar,
  colorPrimary: '#000000'
})

export default MimoIcon
