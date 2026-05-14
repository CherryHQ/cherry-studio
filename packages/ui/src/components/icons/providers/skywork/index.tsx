import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { SkyworkAvatar } from './avatar'
import { SkyworkDark } from './dark'
import { SkyworkLight } from './light'

const Skywork = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <SkyworkLight className={cn('dark:hidden', className)} {...props} />
    <SkyworkDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const SkyworkIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Skywork, {
  Light: SkyworkLight,
  Dark: SkyworkDark,
  Avatar: SkyworkAvatar,
  colorPrimary: '#4D5EFF'
})

export default SkyworkIcon
