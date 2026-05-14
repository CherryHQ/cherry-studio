import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { BailianAvatar } from './avatar'
import { BailianDark } from './dark'
import { BailianLight } from './light'

const Bailian = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <BailianLight className={cn('dark:hidden', className)} {...props} />
    <BailianDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const BailianIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Bailian, {
  Light: BailianLight,
  Dark: BailianDark,
  Avatar: BailianAvatar,
  colorPrimary: '#00EAD1'
})

export default BailianIcon
