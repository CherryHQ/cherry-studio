import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { PalmAvatar } from './avatar'
import { PalmDark } from './dark'
import { PalmLight } from './light'

const Palm = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <PalmLight className={cn('dark:hidden', className)} {...props} />
    <PalmDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const PalmIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Palm, {
  Light: PalmLight,
  Dark: PalmDark,
  Avatar: PalmAvatar,
  colorPrimary: '#FEFEFE'
})

export default PalmIcon
