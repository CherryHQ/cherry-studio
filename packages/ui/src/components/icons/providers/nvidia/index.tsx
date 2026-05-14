import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { NvidiaAvatar } from './avatar'
import { NvidiaDark } from './dark'
import { NvidiaLight } from './light'

const Nvidia = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <NvidiaLight className={cn('dark:hidden', className)} {...props} />
    <NvidiaDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const NvidiaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Nvidia, {
  Light: NvidiaLight,
  Dark: NvidiaDark,
  Avatar: NvidiaAvatar,
  colorPrimary: '#76B900'
})

export default NvidiaIcon
