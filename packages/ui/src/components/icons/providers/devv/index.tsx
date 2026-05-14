import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { DevvAvatar } from './avatar'
import { DevvDark } from './dark'
import { DevvLight } from './light'

const Devv = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <DevvLight className={cn('dark:hidden', className)} {...props} />
    <DevvDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const DevvIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Devv, {
  Light: DevvLight,
  Dark: DevvDark,
  Avatar: DevvAvatar,
  colorPrimary: '#101828'
})

export default DevvIcon
