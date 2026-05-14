import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { XirangAvatar } from './avatar'
import { XirangDark } from './dark'
import { XirangLight } from './light'

const Xirang = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <XirangLight className={cn('dark:hidden', className)} {...props} />
    <XirangDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const XirangIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Xirang, {
  Light: XirangLight,
  Dark: XirangDark,
  Avatar: XirangAvatar,
  colorPrimary: '#DF0428'
})

export default XirangIcon
