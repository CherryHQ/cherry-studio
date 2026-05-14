import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { PoeAvatar } from './avatar'
import { PoeDark } from './dark'
import { PoeLight } from './light'

const Poe = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <PoeLight className={cn('dark:hidden', className)} {...props} />
    <PoeDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const PoeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Poe, {
  Light: PoeLight,
  Dark: PoeDark,
  Avatar: PoeAvatar,
  colorPrimary: '#000000'
})

export default PoeIcon
