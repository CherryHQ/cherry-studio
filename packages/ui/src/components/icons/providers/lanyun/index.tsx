import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { LanyunAvatar } from './avatar'
import { LanyunDark } from './dark'
import { LanyunLight } from './light'

const Lanyun = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <LanyunLight className={cn('dark:hidden', className)} {...props} />
    <LanyunDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const LanyunIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Lanyun, {
  Light: LanyunLight,
  Dark: LanyunDark,
  Avatar: LanyunAvatar,
  colorPrimary: '#000000'
})

export default LanyunIcon
