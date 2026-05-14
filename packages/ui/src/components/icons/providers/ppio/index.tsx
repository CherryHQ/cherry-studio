import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { PpioAvatar } from './avatar'
import { PpioDark } from './dark'
import { PpioLight } from './light'

const Ppio = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <PpioLight className={cn('dark:hidden', className)} {...props} />
    <PpioDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const PpioIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ppio, {
  Light: PpioLight,
  Dark: PpioDark,
  Avatar: PpioAvatar,
  colorPrimary: '#0062E2'
})

export default PpioIcon
