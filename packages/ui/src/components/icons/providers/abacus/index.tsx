import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { AbacusAvatar } from './avatar'
import { AbacusDark } from './dark'
import { AbacusLight } from './light'

const Abacus = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <AbacusLight className={cn('dark:hidden', className)} {...props} />
    <AbacusDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const AbacusIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Abacus, {
  Light: AbacusLight,
  Dark: AbacusDark,
  Avatar: AbacusAvatar,
  colorPrimary: '#D7E5F0'
})

export default AbacusIcon
