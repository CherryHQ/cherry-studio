import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { DoubaoAvatar } from './avatar'
import { DoubaoDark } from './dark'
import { DoubaoLight } from './light'

const Doubao = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <DoubaoLight className={cn('dark:hidden', className)} {...props} />
    <DoubaoDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const DoubaoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Doubao, {
  Light: DoubaoLight,
  Dark: DoubaoDark,
  Avatar: DoubaoAvatar,
  colorPrimary: '#1E37FC'
})

export default DoubaoIcon
