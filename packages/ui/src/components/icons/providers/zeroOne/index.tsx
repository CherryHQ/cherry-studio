import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { ZeroOneAvatar } from './avatar'
import { ZeroOneDark } from './dark'
import { ZeroOneLight } from './light'

const ZeroOne = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <ZeroOneLight className={cn('dark:hidden', className)} {...props} />
    <ZeroOneDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const ZeroOneIcon: CompoundIcon = /*#__PURE__*/ Object.assign(ZeroOne, {
  Light: ZeroOneLight,
  Dark: ZeroOneDark,
  Avatar: ZeroOneAvatar,
  colorPrimary: '#133426'
})

export default ZeroOneIcon
