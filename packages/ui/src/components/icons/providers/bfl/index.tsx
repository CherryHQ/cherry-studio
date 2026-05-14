import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { BflAvatar } from './avatar'
import { BflDark } from './dark'
import { BflLight } from './light'

const Bfl = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <BflLight className={cn('dark:hidden', className)} {...props} />
    <BflDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const BflIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Bfl, {
  Light: BflLight,
  Dark: BflDark,
  Avatar: BflAvatar,
  colorPrimary: '#000000'
})

export default BflIcon
