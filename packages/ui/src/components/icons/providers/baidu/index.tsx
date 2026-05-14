import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { BaiduAvatar } from './avatar'
import { BaiduDark } from './dark'
import { BaiduLight } from './light'

const Baidu = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <BaiduLight className={cn('dark:hidden', className)} {...props} />
    <BaiduDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const BaiduIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Baidu, {
  Light: BaiduLight,
  Dark: BaiduDark,
  Avatar: BaiduAvatar,
  colorPrimary: '#2932E1'
})

export default BaiduIcon
