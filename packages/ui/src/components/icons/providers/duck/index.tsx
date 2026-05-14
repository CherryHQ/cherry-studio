import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { DuckAvatar } from './avatar'
import { DuckDark } from './dark'
import { DuckLight } from './light'

const Duck = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <DuckLight className={cn('dark:hidden', className)} {...props} />
    <DuckDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const DuckIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Duck, {
  Light: DuckLight,
  Dark: DuckDark,
  Avatar: DuckAvatar,
  colorPrimary: '#14307E'
})

export default DuckIcon
