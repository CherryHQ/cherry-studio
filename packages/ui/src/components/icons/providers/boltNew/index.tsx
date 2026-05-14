import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { BoltNewAvatar } from './avatar'
import { BoltNewDark } from './dark'
import { BoltNewLight } from './light'

const BoltNew = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <BoltNewLight className={cn('dark:hidden', className)} {...props} />
    <BoltNewDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const BoltNewIcon: CompoundIcon = /*#__PURE__*/ Object.assign(BoltNew, {
  Light: BoltNewLight,
  Dark: BoltNewDark,
  Avatar: BoltNewAvatar,
  colorPrimary: '#000000'
})

export default BoltNewIcon
