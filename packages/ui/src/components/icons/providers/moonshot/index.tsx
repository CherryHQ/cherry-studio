import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { MoonshotAvatar } from './avatar'
import { MoonshotDark } from './dark'
import { MoonshotLight } from './light'

const Moonshot = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <MoonshotLight className={cn('dark:hidden', className)} {...props} />
    <MoonshotDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const MoonshotIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Moonshot, {
  Light: MoonshotLight,
  Dark: MoonshotDark,
  Avatar: MoonshotAvatar,
  colorPrimary: '#000000'
})

export default MoonshotIcon
