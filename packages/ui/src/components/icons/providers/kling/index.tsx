import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { KlingAvatar } from './avatar'
import { KlingDark } from './dark'
import { KlingLight } from './light'

const Kling = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <KlingLight className={cn('dark:hidden', className)} {...props} />
    <KlingDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const KlingIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Kling, {
  Light: KlingLight,
  Dark: KlingDark,
  Avatar: KlingAvatar,
  colorPrimary: '#000000'
})

export default KlingIcon
