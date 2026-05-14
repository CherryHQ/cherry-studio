import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { AihubmixAvatar } from './avatar'
import { AihubmixDark } from './dark'
import { AihubmixLight } from './light'

const Aihubmix = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <AihubmixLight className={cn('dark:hidden', className)} {...props} />
    <AihubmixDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const AihubmixIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Aihubmix, {
  Light: AihubmixLight,
  Dark: AihubmixDark,
  Avatar: AihubmixAvatar,
  colorPrimary: '#006FFB'
})

export default AihubmixIcon
