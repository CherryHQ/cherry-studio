import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { XiaoyiAvatar } from './avatar'
import { XiaoyiDark } from './dark'
import { XiaoyiLight } from './light'

const Xiaoyi = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <XiaoyiLight className={cn('dark:hidden', className)} {...props} />
    <XiaoyiDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const XiaoyiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Xiaoyi, {
  Light: XiaoyiLight,
  Dark: XiaoyiDark,
  Avatar: XiaoyiAvatar,
  colorPrimary: '#000000'
})

export default XiaoyiIcon
