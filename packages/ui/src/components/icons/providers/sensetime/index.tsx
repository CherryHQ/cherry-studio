import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { SensetimeAvatar } from './avatar'
import { SensetimeDark } from './dark'
import { SensetimeLight } from './light'

const Sensetime = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <SensetimeLight className={cn('dark:hidden', className)} {...props} />
    <SensetimeDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const SensetimeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Sensetime, {
  Light: SensetimeLight,
  Dark: SensetimeDark,
  Avatar: SensetimeAvatar,
  colorPrimary: '#7680F8'
})

export default SensetimeIcon
