import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { TngAvatar } from './avatar'
import { TngDark } from './dark'
import { TngLight } from './light'

const Tng = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <TngLight className={cn('dark:hidden', className)} {...props} />
    <TngDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const TngIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Tng, {
  Light: TngLight,
  Dark: TngDark,
  Avatar: TngAvatar,
  colorPrimary: '#FDFEFE'
})

export default TngIcon
