import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { MacosAvatar } from './avatar'
import { MacosDark } from './dark'
import { MacosLight } from './light'

const Macos = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <MacosLight className={cn('dark:hidden', className)} {...props} />
    <MacosDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const MacosIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Macos, {
  Light: MacosLight,
  Dark: MacosDark,
  Avatar: MacosAvatar,
  colorPrimary: '#000000'
})

export default MacosIcon
