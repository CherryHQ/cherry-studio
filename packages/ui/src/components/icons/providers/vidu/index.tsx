import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { ViduAvatar } from './avatar'
import { ViduDark } from './dark'
import { ViduLight } from './light'

const Vidu = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <ViduLight className={cn('dark:hidden', className)} {...props} />
    <ViduDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const ViduIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Vidu, {
  Light: ViduLight,
  Dark: ViduDark,
  Avatar: ViduAvatar,
  colorPrimary: '#000000'
})

export default ViduIcon
