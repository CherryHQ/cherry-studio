import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { QueritAvatar } from './avatar'
import { QueritDark } from './dark'
import { QueritLight } from './light'

const Querit = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <QueritLight className={cn('dark:hidden', className)} {...props} />
    <QueritDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const QueritIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Querit, {
  Light: QueritLight,
  Dark: QueritDark,
  Avatar: QueritAvatar,
  colorPrimary: '#FDFEFF'
})

export default QueritIcon
