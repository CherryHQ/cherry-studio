import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { DangbeiAvatar } from './avatar'
import { DangbeiDark } from './dark'
import { DangbeiLight } from './light'

const Dangbei = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <DangbeiLight className={cn('dark:hidden', className)} {...props} />
    <DangbeiDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const DangbeiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Dangbei, {
  Light: DangbeiLight,
  Dark: DangbeiDark,
  Avatar: DangbeiAvatar,
  colorPrimary: '#000000'
})

export default DangbeiIcon
