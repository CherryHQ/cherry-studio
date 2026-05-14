import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { RunwayAvatar } from './avatar'
import { RunwayDark } from './dark'
import { RunwayLight } from './light'

const Runway = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <RunwayLight className={cn('dark:hidden', className)} {...props} />
    <RunwayDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const RunwayIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Runway, {
  Light: RunwayLight,
  Dark: RunwayDark,
  Avatar: RunwayAvatar,
  colorPrimary: '#000000'
})

export default RunwayIcon
