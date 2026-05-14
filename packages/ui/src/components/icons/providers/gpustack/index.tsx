import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { GpustackAvatar } from './avatar'
import { GpustackDark } from './dark'
import { GpustackLight } from './light'

const Gpustack = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <GpustackLight className={cn('dark:hidden', className)} {...props} />
    <GpustackDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const GpustackIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpustack, {
  Light: GpustackLight,
  Dark: GpustackDark,
  Avatar: GpustackAvatar,
  colorPrimary: '#000000'
})

export default GpustackIcon
