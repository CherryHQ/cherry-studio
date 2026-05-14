import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { MinimaxAvatar } from './avatar'
import { MinimaxDark } from './dark'
import { MinimaxLight } from './light'

const Minimax = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <MinimaxLight className={cn('dark:hidden', className)} {...props} />
    <MinimaxDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const MinimaxIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Minimax, {
  Light: MinimaxLight,
  Dark: MinimaxDark,
  Avatar: MinimaxAvatar,
  colorPrimary: '#000000'
})

export default MinimaxIcon
